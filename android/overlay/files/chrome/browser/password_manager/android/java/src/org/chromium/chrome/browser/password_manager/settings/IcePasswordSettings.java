// Copyright 2026 The Ice Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

package org.chromium.chrome.browser.password_manager.settings;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.widget.EditText;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.preference.Preference;
import androidx.preference.PreferenceScreen;

import org.chromium.base.supplier.MonotonicObservableSupplier;
import org.chromium.base.supplier.ObservableSuppliers;
import org.chromium.base.supplier.SettableMonotonicObservableSupplier;
import org.chromium.chrome.browser.device_reauth.BiometricStatus;
import org.chromium.chrome.browser.device_reauth.DeviceAuthSource;
import org.chromium.chrome.browser.device_reauth.ReauthenticatorBridge;
import org.chromium.chrome.browser.password_manager.PasswordStoreBridge;
import org.chromium.chrome.browser.password_manager.PasswordStoreCredential;
import org.chromium.chrome.browser.settings.ChromeBaseSettingsFragment;
import org.chromium.url.GURL;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Ice: the password list on Android (Chromium 156 has none without Google Play Services). The
 * passwords are in the local store (as on the desktop). Showing, copying or exporting passwords
 * asks for the phone's screen lock (fingerprint / PIN) first. Import and export use the CSV format
 * of Chrome, Firefox, Edge and the other browsers (name,url,username,password).
 */
public class IcePasswordSettings extends ChromeBaseSettingsFragment
        implements PasswordStoreBridge.PasswordStoreObserver {
    private static final long REAUTH_VALID_MS = 60_000;

    private final SettableMonotonicObservableSupplier<String> mPageTitle =
            ObservableSuppliers.createMonotonic();
    private PasswordStoreBridge mBridge;
    private ReauthenticatorBridge mReauth;
    private long mReauthAt;
    private String mFilter = "";

    private final ActivityResultLauncher<String[]> mImport =
            registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::onImport);
    private final ActivityResultLauncher<String> mExport =
            registerForActivityResult(
                    new ActivityResultContracts.CreateDocument("text/csv"), this::onExport);

    @Override
    public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
        mPageTitle.set("Lozinke");
        setPreferenceScreen(getPreferenceManager().createPreferenceScreen(getStyledContext()));
        mBridge = new PasswordStoreBridge(getProfile());
        mBridge.addObserver(this, true);
        rebuild();
    }

    @Override
    public void onDestroy() {
        if (mBridge != null) {
            mBridge.removeObserver(this);
            mBridge.destroy();
            mBridge = null;
        }
        if (mReauth != null) {
            mReauth.destroy();
            mReauth = null;
        }
        super.onDestroy();
    }

    @Override
    public MonotonicObservableSupplier<String> getPageTitle() {
        return mPageTitle;
    }

    @Override
    public @AnimationType int getAnimationType() {
        return AnimationType.PROPERTY;
    }

    @Override
    public void onSavedPasswordsChanged(int count) {
        rebuild();
    }

    @Override
    public void onEdit(PasswordStoreCredential credential) {
        rebuild();
    }

    private Context getStyledContext() {
        return getPreferenceManager().getContext();
    }

    private Preference action(String title, String summary, Runnable onClick) {
        Preference p = new Preference(getStyledContext());
        p.setTitle(title);
        if (summary != null) p.setSummary(summary);
        p.setOnPreferenceClickListener(
                x -> {
                    onClick.run();
                    return true;
                });
        return p;
    }

    private void rebuild() {
        if (mBridge == null || getContext() == null) return;
        PreferenceScreen screen = getPreferenceScreen();
        screen.removeAll();
        PasswordStoreCredential[] all = mBridge.getAllCredentials();
        Arrays.sort(all, (a, b) -> host(a).compareToIgnoreCase(host(b)));

        screen.addPreference(
                action(
                        "Pretraži",
                        mFilter.isEmpty() ? "Sve lozinke (" + all.length + ")" : "Filter: " + mFilter,
                        this::askFilter));
        screen.addPreference(
                action(
                        "Uvezi lozinke (CSV)",
                        "Iz CSV fajla izvezenog iz Chromea, Firefoxa, Edgea…",
                        () -> mImport.launch(new String[] {"text/*", "application/*"})));
        screen.addPreference(
                action(
                        "Izvezi lozinke (CSV)",
                        "Sve lozinke u CSV fajl (traži otključavanje telefona)",
                        () -> withReauth(() -> mExport.launch("Ice lozinke.csv"))));

        String f = mFilter.toLowerCase(Locale.ROOT);
        for (PasswordStoreCredential c : all) {
            String host = host(c);
            if (!f.isEmpty()
                    && !host.toLowerCase(Locale.ROOT).contains(f)
                    && !c.getUsername().toLowerCase(Locale.ROOT).contains(f)) {
                continue;
            }
            screen.addPreference(
                    action(host, c.getUsername().isEmpty() ? "(bez korisnika)" : c.getUsername(),
                            () -> showCredential(c)));
        }
        if (all.length == 0) {
            Preference empty = new Preference(getStyledContext());
            empty.setSummary(
                    "Nema sačuvanih lozinki. Ice nudi da sačuva lozinku kad se prijaviš na stranicu,"
                            + " ili ih uvezi iz CSV fajla.");
            empty.setSelectable(false);
            screen.addPreference(empty);
        }
    }

    private static String host(PasswordStoreCredential c) {
        GURL url = c.getUrl();
        String h = url.getHost();
        return h.isEmpty() ? url.getSpec() : h;
    }

    private void askFilter() {
        EditText input = new EditText(getStyledContext());
        input.setText(mFilter);
        input.setSingleLine(true);
        new AlertDialog.Builder(getStyledContext())
                .setTitle("Pretraži lozinke")
                .setView(input)
                .setPositiveButton(
                        "Traži",
                        (d, w) -> {
                            mFilter = input.getText().toString().trim();
                            rebuild();
                        })
                .setNeutralButton(
                        "Sve",
                        (d, w) -> {
                            mFilter = "";
                            rebuild();
                        })
                .setNegativeButton("Otkaži", null)
                .show();
    }

    /** Runs {@code then} after the phone's screen lock was confirmed (valid for a minute). */
    private void withReauth(Runnable then) {
        if (System.currentTimeMillis() - mReauthAt < REAUTH_VALID_MS) {
            then.run();
            return;
        }
        Activity activity = getActivity();
        if (activity == null) return;
        if (mReauth == null) {
            mReauth =
                    ReauthenticatorBridge.create(
                            activity, getProfile(), DeviceAuthSource.PASSWORD_MANAGER);
        }
        if (mReauth.getBiometricAvailabilityStatus() == BiometricStatus.UNAVAILABLE) {
            Toast.makeText(
                            activity,
                            "Postavi zaključavanje ekrana (PIN, otisak) da bi vidio lozinke.",
                            Toast.LENGTH_LONG)
                    .show();
            return;
        }
        mReauth.reauthenticate(
                ok -> {
                    if (ok) {
                        mReauthAt = System.currentTimeMillis();
                        then.run();
                    }
                });
    }

    private void showCredential(PasswordStoreCredential c) {
        String details =
                "Stranica: " + c.getUrl().getSpec() + "\nKorisnik: " + c.getUsername()
                        + "\nLozinka: ••••••••";
        AlertDialog dialog =
                new AlertDialog.Builder(getStyledContext())
                        .setTitle(host(c))
                        .setMessage(details)
                        .setPositiveButton("Prikaži lozinku", null)
                        .setNeutralButton("Obriši", null)
                        .setNegativeButton("Zatvori", null)
                        .create();
        dialog.setOnShowListener(
                x -> {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                            .setOnClickListener(
                                    v ->
                                            withReauth(
                                                    () -> {
                                                        dialog.setMessage(
                                                                "Stranica: "
                                                                        + c.getUrl().getSpec()
                                                                        + "\nKorisnik: "
                                                                        + c.getUsername()
                                                                        + "\nLozinka: "
                                                                        + c.getPassword());
                                                        dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                                                                .setText("Kopiraj lozinku");
                                                        dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                                                                .setOnClickListener(
                                                                        w -> copy(c.getPassword()));
                                                    }));
                    dialog.getButton(AlertDialog.BUTTON_NEUTRAL)
                            .setOnClickListener(
                                    v ->
                                            new AlertDialog.Builder(getStyledContext())
                                                    .setMessage(
                                                            "Obrisati lozinku za "
                                                                    + host(c)
                                                                    + "?")
                                                    .setPositiveButton(
                                                            "Obriši",
                                                            (d2, w2) -> {
                                                                if (mBridge != null) {
                                                                    mBridge.iceRemoveCredential(c);
                                                                }
                                                                dialog.dismiss();
                                                            })
                                                    .setNegativeButton("Otkaži", null)
                                                    .show());
                });
        dialog.show();
    }

    private void copy(String text) {
        Context ctx = getStyledContext();
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return;
        cm.setPrimaryClip(ClipData.newPlainText("Lozinka", text));
        Toast.makeText(ctx, "Lozinka kopirana", Toast.LENGTH_SHORT).show();
    }

    // ------------------------------------------------------------------ CSV

    private void onImport(Uri uri) {
        if (uri == null || mBridge == null) return;
        int added = 0;
        int skipped = 0;
        try (InputStream in = requireContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IllegalStateException("fajl se ne može otvoriti");
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            List<List<String>> rows = parseCsv(sb.toString());
            if (rows.isEmpty()) throw new IllegalStateException("prazan fajl");
            List<String> head = rows.get(0);
            int iUrl = col(head, "url", "origin", "website", "login_uri");
            int iUser = col(head, "username", "login", "user", "login_username");
            int iPass = col(head, "password", "login_password");
            if (iUrl < 0 || iPass < 0) {
                throw new IllegalStateException("u prvom redu nema kolona url i password");
            }
            for (int i = 1; i < rows.size(); i++) {
                List<String> row = rows.get(i);
                String url = get(row, iUrl);
                String user = iUser >= 0 ? get(row, iUser) : "";
                String pass = get(row, iPass);
                GURL gurl = new GURL(url);
                if (pass.isEmpty() || !gurl.isValid()
                        || !(gurl.getScheme().equals("https") || gurl.getScheme().equals("http")
                                || gurl.getScheme().equals("android"))) {
                    skipped++;
                    continue;
                }
                mBridge.iceAddCredential(new PasswordStoreCredential(gurl, user, pass));
                added++;
            }
            Toast.makeText(
                            requireContext(),
                            "Uvezeno: " + added + (skipped > 0 ? ", preskočeno: " + skipped : ""),
                            Toast.LENGTH_LONG)
                    .show();
        } catch (Exception e) {
            Toast.makeText(requireContext(), "Uvoz nije uspio: " + e.getMessage(), Toast.LENGTH_LONG)
                    .show();
        }
    }

    private void onExport(Uri uri) {
        if (uri == null || mBridge == null) return;
        StringBuilder sb = new StringBuilder("name,url,username,password\n");
        for (PasswordStoreCredential c : mBridge.getAllCredentials()) {
            sb.append(csv(host(c))).append(',').append(csv(c.getUrl().getSpec())).append(',')
                    .append(csv(c.getUsername())).append(',').append(csv(c.getPassword()))
                    .append('\n');
        }
        try (OutputStream out = requireContext().getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new IllegalStateException("fajl se ne može upisati");
            out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            Toast.makeText(requireContext(), "Lozinke izvezene", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(requireContext(), "Izvoz nije uspio: " + e.getMessage(), Toast.LENGTH_LONG)
                    .show();
        }
    }

    private static String csv(String v) {
        if (v.indexOf(',') < 0 && v.indexOf('"') < 0 && v.indexOf('\n') < 0
                && v.indexOf('\r') < 0) {
            return v;
        }
        return '"' + v.replace("\"", "\"\"") + '"';
    }

    private static int col(List<String> head, String... names) {
        for (String name : names) {
            for (int i = 0; i < head.size(); i++) {
                if (head.get(i).trim().replace("﻿", "").equalsIgnoreCase(name)) return i;
            }
        }
        return -1;
    }

    private static String get(List<String> row, int i) {
        return i >= 0 && i < row.size() ? row.get(i).trim() : "";
    }

    /** RFC 4180: quoted fields, "" inside quotes, line breaks inside quotes. */
    static List<List<String>> parseCsv(String text) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (quoted) {
                if (ch == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    field.append(ch);
                }
            } else if (ch == '"') {
                quoted = true;
            } else if (ch == ',') {
                row.add(field.toString());
                field.setLength(0);
            } else if (ch == '\n' || ch == '\r') {
                if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                row.add(field.toString());
                field.setLength(0);
                if (!(row.size() == 1 && row.get(0).isEmpty())) rows.add(row);
                row = new ArrayList<>();
            } else {
                field.append(ch);
            }
        }
        if (field.length() > 0 || !row.isEmpty()) {
            row.add(field.toString());
            rows.add(row);
        }
        return rows;
    }
}
