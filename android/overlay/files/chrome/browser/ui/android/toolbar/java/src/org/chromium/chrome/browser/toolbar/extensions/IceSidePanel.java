// Copyright 2026 The Ice Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

package org.chromium.chrome.browser.toolbar.extensions;

import android.app.Activity;
import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupWindow;
import android.widget.ScrollView;
import android.widget.TextView;

import org.chromium.base.ContextUtils;
import org.chromium.base.supplier.NullableObservableSupplier;
import org.chromium.build.annotations.NullMarked;
import org.chromium.build.annotations.Nullable;
import org.chromium.chrome.browser.tab.Tab;
import org.chromium.chrome.browser.tab.TabLaunchType;
import org.chromium.chrome.browser.tabmodel.TabCreator;
import org.chromium.chrome.browser.ui.extensions.ExtensionAction;
import org.chromium.chrome.browser.ui.extensions.ExtensionsToolbarBridge;
import org.chromium.chrome.browser.ui.toolbar.InvocationSource;
import org.chromium.content_public.browser.LoadUrlParams;
import org.chromium.content_public.browser.WebContents;
import org.chromium.ui.base.PageTransition;

/**
 * Ice: the Android version of the desktop Ice panel (core-build/patches/ice-20/21), on the RIGHT side.
 *
 * <p>A narrow rail of buttons at the right edge of the window: menu, bookmarks, history, downloads
 * and "Funkcije" (all built-in features and add-ons). "Funkcije" opens a panel at the right side,
 * over the page, listing every extension action with its icon; a tap runs it (its popup opens, as
 * from the extensions menu). On narrow screens (phone, folded) only a small handle is shown, which
 * opens the same panel; the rail itself needs a wide window.
 *
 * <p>Plain views and text symbols only (no new resources), added to the activity's content view.
 */
@NullMarked
class IceSidePanel {
    private static final int WIDE_DP = 600;
    private static final int RAIL_BUTTON_DP = 44;
    private static final int PANEL_WIDTH_DP = 340;

    private final Activity mActivity;
    private final ExtensionsToolbarBridge mBridge;
    private final NullableObservableSupplier<Tab> mTabSupplier;
    private final TabCreator mTabCreator;
    private final ViewGroup mRoot;
    private final LinearLayout mRail;
    private final View.OnLayoutChangeListener mLayoutListener;
    private @Nullable PopupWindow mPanel;
    private boolean mWide;
    private boolean mDestroyed;

    static @Nullable IceSidePanel create(
            Context context,
            ExtensionsToolbarBridge bridge,
            NullableObservableSupplier<Tab> tabSupplier,
            TabCreator tabCreator) {
        Activity activity = ContextUtils.activityFromContext(context);
        if (activity == null) return null;
        View content = activity.findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) return null;
        return new IceSidePanel(activity, (ViewGroup) content, bridge, tabSupplier, tabCreator);
    }

    private IceSidePanel(
            Activity activity,
            ViewGroup root,
            ExtensionsToolbarBridge bridge,
            NullableObservableSupplier<Tab> tabSupplier,
            TabCreator tabCreator) {
        mActivity = activity;
        mRoot = root;
        mBridge = bridge;
        mTabSupplier = tabSupplier;
        mTabCreator = tabCreator;

        mRail = new LinearLayout(activity);
        mRail.setOrientation(LinearLayout.VERTICAL);
        mRail.setPadding(dp(2), dp(6), dp(2), dp(6));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(withAlpha(themeColor(android.R.attr.colorBackground, Color.WHITE), 0xEE));
        bg.setCornerRadii(new float[] {dp(16), dp(16), 0, 0, 0, 0, dp(16), dp(16)});
        mRail.setBackground(bg);
        mRail.setElevation(dp(6));

        FrameLayout.LayoutParams lp =
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.END | Gravity.CENTER_VERTICAL);
        mRoot.addView(mRail, lp);

        mWide = isWide();
        buildRail();
        mLayoutListener =
                (v, l, t, r, b, ol, ot, or, ob) -> {
                    boolean wide = isWide();
                    if (wide != mWide) {
                        mWide = wide;
                        buildRail();
                    }
                };
        mRoot.addOnLayoutChangeListener(mLayoutListener);
    }

    void destroy() {
        if (mDestroyed) return;
        mDestroyed = true;
        dismissPanel();
        mRoot.removeOnLayoutChangeListener(mLayoutListener);
        mRoot.removeView(mRail);
    }

    private boolean isWide() {
        return mActivity.getResources().getConfiguration().screenWidthDp >= WIDE_DP;
    }

    private void buildRail() {
        mRail.removeAllViews();
        if (!mWide) {
            // Narrow window: a small handle on the right edge opens the panel.
            mRail.addView(railButton("‹", "Ice", v -> togglePanel()));
            return;
        }
        mRail.addView(railButton("☰", "Meni", v -> openAppMenu()));
        mRail.addView(railButton("★", "Bookmarks", v -> openPage("chrome://bookmarks/")));
        mRail.addView(railButton("⏲", "Historija", v -> openPage("chrome://history/")));
        mRail.addView(railButton("⬇", "Preuzimanja", v -> openPage("chrome://downloads/")));
        mRail.addView(railButton("✦", "Funkcije", v -> togglePanel()));
    }

    private TextView railButton(String symbol, String description, View.OnClickListener onClick) {
        TextView b = new TextView(mActivity);
        b.setText(symbol);
        b.setContentDescription(description);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        b.setGravity(Gravity.CENTER);
        b.setTextColor(themeColor(android.R.attr.textColorPrimary, Color.DKGRAY));
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(RAIL_BUTTON_DP), dp(RAIL_BUTTON_DP)));
        TypedValue ripple = new TypedValue();
        if (mActivity
                .getTheme()
                .resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true)) {
            b.setBackgroundResource(ripple.resourceId);
        }
        b.setOnClickListener(onClick);
        return b;
    }

    /** The browser's own app menu (the three-dot button of the toolbar). */
    private void openAppMenu() {
        int id = mActivity.getResources().getIdentifier("menu_button", "id", mActivity.getPackageName());
        View menu = id != 0 ? mActivity.findViewById(id) : null;
        if (menu != null) menu.performClick();
    }

    private void openPage(String url) {
        dismissPanel();
        mTabCreator.createNewTab(
                new LoadUrlParams(url, PageTransition.AUTO_TOPLEVEL),
                TabLaunchType.FROM_CHROME_UI,
                mTabSupplier.get());
    }

    private void togglePanel() {
        if (mPanel != null && mPanel.isShowing()) {
            dismissPanel();
            return;
        }
        showPanel();
    }

    private void dismissPanel() {
        if (mPanel != null) mPanel.dismiss();
        mPanel = null;
    }

    private void showPanel() {
        Tab tab = mTabSupplier.get();
        WebContents webContents = tab != null ? tab.getWebContents() : null;
        int textColor = themeColor(android.R.attr.textColorPrimary, Color.DKGRAY);

        LinearLayout list = new LinearLayout(mActivity);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(8), dp(8), dp(8), dp(16));

        LinearLayout header = new LinearLayout(mActivity);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(mActivity);
        title.setText("Funkcije");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(textColor);
        title.setPadding(dp(8), dp(8), dp(8), dp(8));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView close = new TextView(mActivity);
        close.setText("✕");
        close.setContentDescription("Zatvori");
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        close.setGravity(Gravity.CENTER);
        close.setTextColor(textColor);
        close.setOnClickListener(v -> dismissPanel());
        header.addView(close, new LinearLayout.LayoutParams(dp(44), dp(44)));
        list.addView(header);

        float scale = mActivity.getResources().getDisplayMetrics().density;
        for (String id : mBridge.getAllActionIds()) {
            ExtensionAction action = mBridge.getAction(id, webContents);
            if (action == null) continue;
            LinearLayout row = new LinearLayout(mActivity);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(8), dp(10), dp(8), dp(10));
            TypedValue ripple = new TypedValue();
            if (mActivity
                    .getTheme()
                    .resolveAttribute(android.R.attr.selectableItemBackground, ripple, true)) {
                row.setBackgroundResource(ripple.resourceId);
            }
            ImageView icon = new ImageView(mActivity);
            Bitmap bitmap = mBridge.getIcon(id, webContents, 24, 24, scale);
            if (bitmap != null) icon.setImageBitmap(bitmap);
            row.addView(icon, new LinearLayout.LayoutParams(dp(28), dp(28)));
            TextView name = new TextView(mActivity);
            String label = action.getName();
            name.setText(label.isEmpty() ? action.getTitle() : label);
            name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            name.setTextColor(textColor);
            name.setPadding(dp(16), 0, 0, 0);
            row.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            row.setOnClickListener(
                    v -> {
                        dismissPanel();
                        mBridge.executeUserAction(id, InvocationSource.MENU_ENTRY);
                    });
            list.addView(row);
        }

        ScrollView scroll = new ScrollView(mActivity);
        scroll.addView(list);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(themeColor(android.R.attr.colorBackground, Color.WHITE));
        bg.setCornerRadii(new float[] {dp(20), dp(20), 0, 0, 0, 0, dp(20), dp(20)});
        scroll.setBackground(bg);
        scroll.setElevation(dp(12));

        int width = Math.min(dp(PANEL_WIDTH_DP), (int) (mRoot.getWidth() * 0.85f));
        int height = Math.max(dp(240), mRoot.getHeight() - dp(96));
        PopupWindow panel = new PopupWindow(scroll, width, height, true);
        panel.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        panel.setOutsideTouchable(true);
        panel.setElevation(dp(12));
        panel.setOnDismissListener(
                () -> {
                    if (mPanel == panel) mPanel = null;
                });
        mPanel = panel;
        panel.showAtLocation(mRoot, Gravity.END | Gravity.CENTER_VERTICAL, 0, 0);
    }

    private int dp(int v) {
        return Math.round(v * mActivity.getResources().getDisplayMetrics().density);
    }

    private int themeColor(int attr, int fallback) {
        TypedArray a = mActivity.getTheme().obtainStyledAttributes(new int[] {attr});
        try {
            return a.getColor(0, fallback);
        } finally {
            a.recycle();
        }
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }
}
