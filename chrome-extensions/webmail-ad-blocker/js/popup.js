"use strict";

var WAB_DISABLED_HOSTS_STORAGE_KEY = "disabledBlockingHosts";
var YAHOO_REMOVE_RIGHT_SIDE_KEY = "yahoo-remove-right-side";
var POPUP_UPDATE_AVAILABLE_VERSION_KEY = "popupUpdateAvailableVersion";
var POPUP_UPDATE_SEEN_VERSION_KEY = "popupUpdateSeenVersion";

function getSiteMeta(url) {
    if (!url) {
        return null;
    }

    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;

        if (host === "mail.google.com") {
            return { id: "gmail", title: getMessage("popupSiteGmail"), host: host, origin: "https://mail.google.com/*" };
        }

        if (host === "outlook.live.com") {
            return { id: "outlook", title: getMessage("popupSiteOutlook"), host: host, origin: "https://outlook.live.com/*" };
        }

        if (host === "mail.yahoo.com" || /\.mail\.yahoo\.com$/i.test(host)) {
            return { id: "yahoo", title: getMessage("popupSiteYahooMail"), host: host, origin: `https://${host}/*` };
        }
    } catch (error) {
        console.warn("Could not parse current tab URL", error);
    }

    return null;
}

function setPopupStatus(statusText, hostText) {
    byId("siteStatus").textContent = statusText;
    byId("siteHost").textContent = hostText || "";
}

async function initUpdateButton() {
    const seeUpdatesButton = byId("seeUpdates");
    if (!seeUpdatesButton) {
        return;
    }

    const currentVersion = chrome.runtime.getManifest().version;
    const updateKeys = await chrome.storage.local.get([
        POPUP_UPDATE_AVAILABLE_VERSION_KEY,
        POPUP_UPDATE_SEEN_VERSION_KEY
    ]);

    const showUpdateButton =
        updateKeys[POPUP_UPDATE_AVAILABLE_VERSION_KEY] === currentVersion
        && updateKeys[POPUP_UPDATE_SEEN_VERSION_KEY] !== currentVersion;

    seeUpdatesButton.hidden = !showUpdateButton;

    seeUpdatesButton.addEventListener("click", async () => {
        await chrome.storage.local.set({ [POPUP_UPDATE_SEEN_VERSION_KEY]: currentVersion });
        seeUpdatesButton.hidden = true;
        openUrl("https://jasonsavard.com/wiki/Webmail_Ad_Blocker_changelog?ref=WABPopupUpdate");
    });
}

async function refreshPageStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const toggle = byId("blockingToggle");
    const toggleInline = byId("blockingToggleInline");
    const yahooOptions = byId("yahooOptions");
    const yahooRemoveRightSide = byId("yahooRemoveRightSide");

    if (!tab?.url) {
        if (tab?.id != null) {
            chrome.runtime.sendMessage({ name: "setBadgeState", tabId: tab.id, state: "clear" });
        }
        toggleInline.style.display = "none";
        yahooOptions.style.display = "none";
        setPopupStatus(getMessage("popupCouldNotDetectTab"), "");
        return;
    }

    const siteMeta = getSiteMeta(tab.url);
    if (!siteMeta) {
        if (tab.id != null) {
            chrome.runtime.sendMessage({ name: "setBadgeState", tabId: tab.id, state: "clear" });
        }
        toggleInline.style.display = "none";
        yahooOptions.style.display = "none";
        setPopupStatus(getMessage("popupUnsupportedPage"), getMessage("popupUnsupportedPageHint"));
        return;
    }

    const [disabledHostResult, hasPermission, yahooRemoveRightSideObj] = await Promise.all([
        chrome.storage.local.get(WAB_DISABLED_HOSTS_STORAGE_KEY),
        chrome.permissions.contains({ origins: [siteMeta.origin] }),
        chrome.storage.local.get(YAHOO_REMOVE_RIGHT_SIDE_KEY)
    ]);

    const disabledHostsRaw = disabledHostResult[WAB_DISABLED_HOSTS_STORAGE_KEY];
    const disabledHosts = Array.isArray(disabledHostsRaw) ? disabledHostsRaw : [];
    const isDisabled = disabledHosts.includes(siteMeta.host);
    const isActive = hasPermission && !isDisabled;

    if (!hasPermission) {
        setPopupStatus(getMessage("popupStatusNotActiveOnSite", siteMeta.title), getMessage("popupHostPermissionNotEnabled"));
    } else if (isActive) {
        setPopupStatus(getMessage("popupStatusActiveOnSite", siteMeta.title), siteMeta.host);
    } else {
        setPopupStatus(getMessage("popupStatusPausedOnSite", siteMeta.title), siteMeta.host);
    }

    if (tab.id != null) {
        chrome.runtime.sendMessage({ name: "setBadgeState", tabId: tab.id, state: isActive ? "active" : "inactive" });
    }

    toggleInline.style.display = "inline-flex";
    toggle.checked = isActive;
    toggle.disabled = false;
    toggle.dataset.tabId = String(tab.id);
    toggle.dataset.host = siteMeta.host;
    toggle.dataset.origin = siteMeta.origin;

    if (siteMeta.id === "yahoo") {
        yahooOptions.style.display = "flex";
        yahooRemoveRightSide.checked = !!yahooRemoveRightSideObj[YAHOO_REMOVE_RIGHT_SIDE_KEY];
        yahooRemoveRightSide.dataset.tabId = String(tab.id);
    } else {
        yahooOptions.style.display = "none";
    }
}

docReady(() => {
    initUI();
    initVersionCheck();
    initUpdateButton();

    const toggle = byId("blockingToggle");
    const yahooRemoveRightSide = byId("yahooRemoveRightSide");

    toggle.addEventListener("change", async () => {
        toggle.disabled = true;

        const enabled = toggle.checked;
        const tabId = Number(toggle.dataset.tabId);
        const host = toggle.dataset.host;
        const origin = toggle.dataset.origin;

        try {
            if (enabled) {
                const hasPermission = await chrome.permissions.contains({ origins: [origin] });
                if (!hasPermission) {
                    const granted = await chrome.permissions.request({ origins: [origin] });
                    if (!granted) {
                        toggle.checked = false;
                        await refreshPageStatus();
                        return;
                    }
                }
            }

            await chrome.runtime.sendMessage({
                name: "setBlockingEnabledForHost",
                host: host,
                enabled: enabled,
                tabId: tabId,
                reloadTab: true
            });
        } catch (error) {
            console.error("Could not toggle per-host blocking", error);
            toggle.checked = !enabled;
        } finally {
            await refreshPageStatus();
        }
    });

    yahooRemoveRightSide.addEventListener("change", async () => {
        yahooRemoveRightSide.disabled = true;
        const enabled = yahooRemoveRightSide.checked;
        const tabId = Number(yahooRemoveRightSide.dataset.tabId);

        try {
            await chrome.storage.local.set({ [YAHOO_REMOVE_RIGHT_SIDE_KEY]: enabled });
            if (!Number.isNaN(tabId)) {
                await chrome.tabs.reload(tabId);
            }
        } catch (error) {
            console.error("Could not set Yahoo remove-right-side option", error);
            yahooRemoveRightSide.checked = !enabled;
        } finally {
            yahooRemoveRightSide.disabled = false;
            await refreshPageStatus();
        }
    });

    byId("contribute").addEventListener("click", () => {
        openUrl("https://jasonsavard.com/contribute?ref=WABPopup");
    });

    byId("tryMyOtherExtensions").addEventListener("click", (event) => {
        openUrl("https://jasonsavard.com?ref=WABPopup");
    });

    refreshPageStatus().catch(error => {
        console.error("Could not initialize popup status", error);
        setPopupStatus(getMessage("popupCouldNotReadPageStatus"), "");
    });
});