// Copyright 2026 The Ice Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

package org.chromium.chrome.browser.toolbar.extensions;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.widget.ImageView;
import android.widget.LinearLayout;

import org.chromium.base.ContextUtils;
import org.chromium.base.supplier.NullableObservableSupplier;
import org.chromium.build.annotations.NullMarked;
import org.chromium.build.annotations.Nullable;
import org.chromium.chrome.browser.tab.Tab;
import org.chromium.chrome.browser.ui.extensions.ExtensionAction;
import org.chromium.chrome.browser.ui.extensions.ExtensionsToolbarBridge;
import org.chromium.chrome.browser.ui.toolbar.InvocationSource;
import org.chromium.content_public.browser.WebContents;

import java.util.ArrayList;
import java.util.List;

/**
 * Ice: buttons for the extensions with popups (Video Sniffer, SN Downloader, Tab Session Manager,
 * Default Quality Adjuster) at the end of the bookmark bar, in place of "All bookmarks". A tap
 * opens the extension's popup. The bookmarks keep the rest of the bar (items that do not fit go to
 * the bar's overflow button, as on the desktop).
 *
 * <p>The bookmark bar is created by another module and can be created again (theme, window size),
 * so the buttons are put into it whenever it appears, found by its view ids.
 */
@NullMarked
class IceBookmarkBarExtensions {
    /** Extension names, in the order of the buttons. */
    private static final String[] NAMES = {
        "Video Sniffer", "Ultimate SN Downloader", "Tab Session Manager", "Default Quality Adjuster"
    };

    private static final String TAG_CONTAINER = "ice_bookmark_bar_extensions";
    private static final int ICON_DP = 24;
    private static final int BUTTON_DP = 40;
    private static final long CHECK_INTERVAL_MS = 1500;

    private final Activity mActivity;
    private final ExtensionsToolbarBridge mBridge;
    private final NullableObservableSupplier<Tab> mTabSupplier;
    private final View mDecor;
    private final ViewTreeObserver.OnGlobalLayoutListener mLayoutListener;
    private long mLastCheck;
    private String mShownIds = "";
    private boolean mDestroyed;

    static @Nullable IceBookmarkBarExtensions create(
            Context context,
            ExtensionsToolbarBridge bridge,
            NullableObservableSupplier<Tab> tabSupplier) {
        Activity activity = ContextUtils.activityFromContext(context);
        if (activity == null || activity.getWindow() == null) return null;
        return new IceBookmarkBarExtensions(activity, bridge, tabSupplier);
    }

    private IceBookmarkBarExtensions(
            Activity activity,
            ExtensionsToolbarBridge bridge,
            NullableObservableSupplier<Tab> tabSupplier) {
        mActivity = activity;
        mBridge = bridge;
        mTabSupplier = tabSupplier;
        mDecor = activity.getWindow().getDecorView();
        mLayoutListener = this::maybeUpdate;
        mDecor.getViewTreeObserver().addOnGlobalLayoutListener(mLayoutListener);
    }

    void destroy() {
        if (mDestroyed) return;
        mDestroyed = true;
        mDecor.getViewTreeObserver().removeOnGlobalLayoutListener(mLayoutListener);
    }

    private int viewId(String name) {
        return mActivity.getResources().getIdentifier(name, "id", mActivity.getPackageName());
    }

    private void maybeUpdate() {
        if (mDestroyed) return;
        long now = SystemClock.uptimeMillis();
        int allId = viewId("bookmark_bar_all_bookmarks_button");
        if (allId == 0) return;
        View all = mDecor.findViewById(allId);
        if (all == null || !(all.getParent() instanceof ViewGroup)) return;
        ViewGroup row = (ViewGroup) all.getParent();
        View existing = row.findViewWithTag(TAG_CONTAINER);
        // The bar may show "All bookmarks" again when it updates its buttons.
        if (existing != null && all.getVisibility() != View.GONE) all.setVisibility(View.GONE);
        // A new bookmark bar (no buttons yet) is filled at once; otherwise only now and then, as
        // extensions may load after the bar is shown.
        if (existing != null && now - mLastCheck < CHECK_INTERVAL_MS) return;
        mLastCheck = now;

        List<String> ids = findActionIds();
        String key = String.join(",", ids);
        if (existing != null && key.equals(mShownIds)) return;
        if (ids.isEmpty()) return;
        mShownIds = key;

        if (existing != null) row.removeView(existing);
        all.setVisibility(View.GONE);
        int dividerId = viewId("bookmark_bar_divider");
        View divider = dividerId != 0 ? row.findViewById(dividerId) : null;
        if (divider != null) divider.setVisibility(View.VISIBLE);

        LinearLayout box = new LinearLayout(mActivity);
        box.setTag(TAG_CONTAINER);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        WebContents webContents = currentWebContents();
        float density = mActivity.getResources().getDisplayMetrics().density;
        for (String id : ids) {
            box.addView(button(id, webContents, density));
        }
        row.addView(
                box,
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private @Nullable WebContents currentWebContents() {
        Tab tab = mTabSupplier.get();
        return tab != null ? tab.getWebContents() : null;
    }

    private List<String> findActionIds() {
        List<String> result = new ArrayList<>();
        String[] all;
        try {
            all = mBridge.getAllActionIds();
        } catch (RuntimeException e) {
            return result;
        }
        for (String wanted : NAMES) {
            for (String id : all) {
                ExtensionAction action = mBridge.getAction(id, null);
                if (action != null && action.getName().startsWith(wanted)) {
                    result.add(id);
                    break;
                }
            }
        }
        return result;
    }

    private View button(String id, @Nullable WebContents webContents, float density) {
        ImageView b = new ImageView(mActivity);
        int size = Math.round(BUTTON_DP * density);
        int pad = Math.round((BUTTON_DP - ICON_DP) / 2f * density);
        b.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        b.setPadding(pad, pad, pad, pad);
        b.setScaleType(ImageView.ScaleType.FIT_CENTER);
        Bitmap icon = mBridge.getIcon(id, webContents, ICON_DP, ICON_DP, density);
        if (icon != null) b.setImageBitmap(icon);
        ExtensionAction action = mBridge.getAction(id, webContents);
        if (action != null) b.setContentDescription(action.getName());
        TypedValue ripple = new TypedValue();
        if (mActivity
                .getTheme()
                .resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true)) {
            b.setBackgroundResource(ripple.resourceId);
        }
        b.setOnClickListener(v -> mBridge.executeUserAction(id, InvocationSource.MENU_ENTRY));
        return b;
    }
}
