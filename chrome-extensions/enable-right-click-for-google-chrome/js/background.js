import { WelcomePage } from "./welcome.js";

chrome.action.onClicked.addListener(function (tab) {
  onClicked(tab);
});

function onClicked(tab) {

  const root = chrome.runtime.getURL('');
  const tabid = tab.id;
  if (tab.url && tab.url.startsWith(root)
    || tab.url && tab.url.startsWith("chrome://")
    || tab.url && tab.url.startsWith("https://chrome.google.com/")) {
    chrome.tabs.sendMessage(tab.id, {
      cmd: 'close'
    });
  }
  else {
    chrome.scripting.executeScript({
      target: {
        tabId: tabid,
      },
      files: ["/onload.js"]
    }).then(() => {
      chrome.action.setBadgeText({
        tabId: tabid,
        text: "ON"
      });
    });


  }
}

new WelcomePage();