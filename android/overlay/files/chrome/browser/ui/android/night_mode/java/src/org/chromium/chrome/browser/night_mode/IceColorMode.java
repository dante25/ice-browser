// Copyright 2026 The Ice Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

package org.chromium.chrome.browser.night_mode;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;

import org.chromium.base.ApplicationStatus;
import org.chromium.base.ContextUtils;
import org.chromium.base.task.PostTask;
import org.chromium.base.task.TaskTraits;
import org.chromium.build.annotations.NullMarked;
import org.chromium.build.annotations.Nullable;

/**
 * Ice: which colours the browser UI uses (Settings > Theme > Colours). ICE, the Ice palette, is the
 * default; SYSTEM uses the wallpaper colours of Android 12+ (Material You); CUSTOM builds a Material
 * colour scheme from a colour the user enters.
 */
@NullMarked
public final class IceColorMode {
    public static final String PREF_MODE = "ice_color_mode";
    public static final String PREF_CUSTOM = "ice_custom_color";
    public static final String ICE = "ice";
    public static final String SYSTEM = "system";
    public static final String CUSTOM = "custom";
    public static final String DEFAULT_CUSTOM = "#0B6E85";

    private IceColorMode() {}

    private static SharedPreferences prefs() {
        return ContextUtils.getAppSharedPreferences();
    }

    public static String getMode() {
        String mode = prefs().getString(PREF_MODE, ICE);
        if (SYSTEM.equals(mode)) return SYSTEM;
        if (CUSTOM.equals(mode)) return CUSTOM;
        return ICE;
    }

    public static void setMode(String mode) {
        prefs().edit().putString(PREF_MODE, mode).apply();
    }

    public static String getCustomColorText() {
        String text = prefs().getString(PREF_CUSTOM, DEFAULT_CUSTOM);
        return text == null ? DEFAULT_CUSTOM : text;
    }

    public static void setCustomColorText(String text) {
        prefs().edit().putString(PREF_CUSTOM, normalize(text)).apply();
    }

    /** The custom colour, or null if what was entered is not a colour. */
    public static @Nullable Integer getCustomColor() {
        return parse(getCustomColorText());
    }

    /** Accepts #RRGGBB, RRGGBB, #RGB and RGB. */
    public static boolean isValidColor(String text) {
        return parse(text) != null;
    }

    private static String normalize(String text) {
        String t = text.trim();
        if (!t.startsWith("#")) t = "#" + t;
        if (t.length() == 4) {
            t = "#" + t.charAt(1) + t.charAt(1) + t.charAt(2) + t.charAt(2) + t.charAt(3) + t.charAt(3);
        }
        return t.toUpperCase(java.util.Locale.ROOT);
    }

    private static @Nullable Integer parse(String text) {
        String t = normalize(text);
        if (t.length() != 7) return null;
        try {
            return Color.parseColor(t);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Re-creates the open activities so that a new colour choice shows at once. */
    public static void applyToRunningActivities() {
        PostTask.postTask(
                TaskTraits.UI_DEFAULT,
                () -> {
                    for (Activity activity : ApplicationStatus.getRunningActivities()) {
                        activity.recreate();
                    }
                });
    }
}
