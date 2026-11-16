// Copyright 2015 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

package org.chromium.chrome.browser.download;

import android.app.Activity;

import org.chromium.base.ApplicationStatus;
import org.chromium.base.ContextUtils;
import org.chromium.build.annotations.NullMarked;
import org.chromium.build.annotations.Nullable;
import org.chromium.chrome.R;
import org.chromium.chrome.browser.app.ChromeActivity;
import org.chromium.chrome.browser.profiles.OtrProfileId;
import org.chromium.chrome.browser.ui.messages.snackbar.Snackbar;
import org.chromium.chrome.browser.ui.messages.snackbar.SnackbarManager;
import org.chromium.components.messages.MessageBannerProperties;
import org.chromium.components.messages.MessageDispatcher;
import org.chromium.components.messages.MessageDispatcherProvider;
import org.chromium.components.messages.MessageIdentifier;
import org.chromium.components.messages.PrimaryActionClickBehavior;
import org.chromium.ui.modelutil.PropertyModel;

/** Class for displaying a snackbar when a download completes. */
@NullMarked
public class DownloadSnackbarController implements SnackbarManager.SnackbarController {
    public static final int INVALID_NOTIFICATION_ID = -1;
    // Ice: 2 s instead of 7 s.
    private static final int SNACKBAR_DURATION_MS = 2000;

    @Override
    public void onAction(@Nullable Object actionData) {
        DownloadManagerService.openDownloadsPage(
                /* otrProfileId= */ null, DownloadOpenSource.SNACK_BAR);
    }

    @Override
    public void onDismissNoAction(@Nullable Object actionData) {}

    /**
     * Called to display the download failed snackbar.
     *
     * @param errorMessage The message to show on the snackbar.
     * @param showAllDownloads Whether to show all downloads in case the failure is caused by
     *     duplicated files.
     * @param otrProfileId The {@link OtrProfileId} of the download. Null if in regular mode.
     */
    public void onDownloadFailed(
            String errorMessage, boolean showAllDownloads, @Nullable OtrProfileId otrProfileId) {
        if (isShowingDownloadInfoBar(otrProfileId)) return;
        if (showIceMessage(errorMessage, showAllDownloads)) return;
        if (getSnackbarManager() == null) return;
        // TODO(qinmin): Coalesce snackbars if multiple downloads finish at the same time.
        Snackbar snackbar =
                Snackbar.make(
                                errorMessage,
                                this,
                                Snackbar.TYPE_NOTIFICATION,
                                Snackbar.UMA_DOWNLOAD_FAILED)
                        .setDefaultLines(false)
                        .setDuration(SNACKBAR_DURATION_MS);
        if (showAllDownloads) {
            snackbar.setAction(
                    ContextUtils.getApplicationContext().getString(R.string.open_downloaded_label),
                    null);
        }
        getSnackbarManager().showSnackbar(snackbar);
    }

    /**
     * Displays a snackbar that says alerts the user that some downloads may be missing because a
     * missing SD card was detected.
     */
    void onDownloadDirectoryNotFound() {
        if (showIceMessage(
                ContextUtils.getApplicationContext()
                        .getString(R.string.download_location_no_sd_card_snackbar),
                false)) {
            return;
        }
        if (getSnackbarManager() == null) return;

        Snackbar snackbar =
                Snackbar.make(
                                ContextUtils.getApplicationContext()
                                        .getString(R.string.download_location_no_sd_card_snackbar),
                                this,
                                Snackbar.TYPE_NOTIFICATION,
                                Snackbar.UMA_MISSING_FILES_NO_SD_CARD)
                        .setDefaultLines(false)
                        .setDuration(SNACKBAR_DURATION_MS);
        getSnackbarManager().showSnackbar(snackbar);
    }

    /**
     * Ice: shows the text as a message banner at the top (2 s, like the other download banners)
     * instead of a snackbar at the bottom. Returns false if there is no message UI.
     */
    private boolean showIceMessage(String text, boolean showAllDownloads) {
        Activity activity = getActivity();
        if (!(activity instanceof ChromeActivity chromeActivity)) return false;
        MessageDispatcher dispatcher =
                MessageDispatcherProvider.from(chromeActivity.getWindowAndroid());
        if (dispatcher == null) return false;
        PropertyModel model =
                new PropertyModel.Builder(MessageBannerProperties.ALL_KEYS)
                        .with(
                                MessageBannerProperties.MESSAGE_IDENTIFIER,
                                MessageIdentifier.DOWNLOAD_PROGRESS)
                        .with(MessageBannerProperties.TITLE, text)
                        .with(
                                MessageBannerProperties.ICON_RESOURCE_ID,
                                R.drawable.ic_file_download_24dp)
                        .with(MessageBannerProperties.ON_DISMISSED, reason -> {})
                        .build();
        if (showAllDownloads) {
            model.set(
                    MessageBannerProperties.PRIMARY_BUTTON_TEXT,
                    activity.getString(R.string.open_downloaded_label));
            model.set(
                    MessageBannerProperties.ON_PRIMARY_ACTION,
                    () -> {
                        onAction(null);
                        return PrimaryActionClickBehavior.DISMISS_IMMEDIATELY;
                    });
        } else {
            model.set(
                    MessageBannerProperties.ON_PRIMARY_ACTION,
                    () -> PrimaryActionClickBehavior.DISMISS_IMMEDIATELY);
        }
        dispatcher.enqueueWindowScopedMessage(model, /* highPriority= */ false);
        return true;
    }

    private @Nullable Activity getActivity() {
        if (ApplicationStatus.hasVisibleActivities()) {
            return ApplicationStatus.getLastTrackedFocusedActivity();
        } else {
            return null;
        }
    }

    public @Nullable SnackbarManager getSnackbarManager() {
        Activity activity = getActivity();
        if (activity != null && activity instanceof SnackbarManager.SnackbarManageable manageable) {
            return manageable.getSnackbarManager();
        }
        return null;
    }

    private boolean isShowingDownloadInfoBar(@Nullable OtrProfileId otrProfileId) {
        DownloadMessageUiController messageUiController =
                DownloadManagerService.getDownloadManagerService()
                        .getMessageUiController(otrProfileId);
        return messageUiController == null ? false : messageUiController.isShowing();
    }
}
