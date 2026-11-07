"use strict";

(function(){
    const BLOCKING_DISABLED_HOSTS_KEY = "disabledBlockingHosts";

    function sendBlockingState(isActive, webmailName) {
        try {
            chrome.runtime.sendMessage({
                name: "blockingStateChanged",
                isActive: isActive,
                webmailName: webmailName,
                url: location.href
            }, () => {
                if (chrome.runtime.lastError) {
                    // Ignore errors when the background context is unavailable.
                }
            });
        } catch (error) {
            console.warn("Could not send blocking state", error);
        }
    }

	var init = async function() {

		var addStyle = function(css){
			var s = document.createElement('style');
			s.setAttribute('id', 'webmailAdBlocker');
			s.setAttribute('type', 'text/css');
			s.appendChild(document.createTextNode(css));
			return (document.getElementsByTagName('head')[0] || document.documentElement).appendChild(s);
        };

        function hide(cssSnippet) {
            css += " " + cssSnippet + " {display:none !important}\n";
        }

        function addC(selector, cssSnippet) {
            css += " " + selector + " {" + cssSnippet + "}\n";
        }

        async function getStorageItem(key) {
            try {
                const items = await chrome.storage.local.get(key);
                return items[key];
            } catch (error) {
                console.error("Error getting storage item " + key + ": " + error);
            }
        }
        
		if (document.documentElement instanceof HTMLHtmlElement) {
			var cssAdded = false;
			var css = "@namespace url(http://www.w3.org/1999/xhtml); ";
			var webmailName;

            const currentHost = location.hostname;
            const disabledHostsObj = await chrome.storage.local.get(BLOCKING_DISABLED_HOSTS_KEY);
            const disabledHosts = disabledHostsObj[BLOCKING_DISABLED_HOSTS_KEY] || [];
            if (disabledHosts.includes(currentHost)) {
                sendBlockingState(false, null);
                return true;
            }

			if (document.location.href.match("mail.google.")) {
				cssAdded = true;
                webmailName = "gmail";
                
				// Hide People Widget: extension used to show ads/peoplewidget by default before June 12th, 2016
				// Old version
				addC("#fi #fic", "margin-right:100px !important");
                addC("#fi #rh", "margin-left:-115px !important;width:95px !important");
                hide("#fi .rh");

				//css += " body:not(.xE) .m .Bs .Bu:not(:first-child) {display: none !important} "; /* .m is because the .bu happen above if right side chat is enabled. Completeling remove last bu and .xiu1Fc is used for excluding popout view it's the class of the <html> tag */
				hide("body:not(.xE) div[role='main'] .Bu:not(:first-child)"); /* Using div[role='main'] because i found out that .Bs and .Bu was used higher up in the node atleast with right side chat etc. */
                
                // end people widget
				
                // Hide ad below people widget
                hide(".Bs .Bu:last-child .oM"); /* ads*/
                hide(".Bs .Bu:last-child .u8"); /* about these links */

				// hover ad when scrolling down
				hide(".AT");

				// new comment: ad above promotions emails -- old comment: ad above message area
                addC(".aKB .a2q", "padding-bottom:0");
                hide(".aKB .a2q .F.cf");

                // Ad below email content (refer to ghazel@gmail.com for html or Mike Tirakis has reported it to me, a bit suspicious)
                hide(".z0DeRc");

                // another ad below by Christian Szita
                hide(".nH.hx .nH.PS");

                // Ad below email content (refer to ghazel@gmail.com for html or Mike Tirakis has reported it to me, a bit suspicious)
                hide("iframe[src*='http://pagead2.googlesyndication.com']");
                
                // Hide ads below Social and Promotions tabs (the :not is to ignore the Primary tab)
                hide(".ae4.aDM:not(:first-child) .Cp:first-child");
                hide(".zA:has(.ast)"); // for Brave ref: https://jasonsavard.com/forum/discussion/comment/34251#Comment_34251

                // Hide ads below Promotions tab
                hide(".ae4.aDM:not(:first-child) .U9 + .Cp + .Cp");

                const AD_INFO_SELECTOR = '[aria-label="Ad info"], [data-tooltip="Ad info"]';

                function isSponsoredRow(row) {
                    return row.querySelector(AD_INFO_SELECTOR) && /\bSponsored\b/.test(row.textContent || "");
                }

                function handleSponsoredRow(row) {
                    if (row.dataset.sponsoredBlocked || !isSponsoredRow(row)) {
                        return;
                    }

                    row.dataset.sponsoredBlocked = "1";
                    row.style.setProperty("display", "none", "important");
                }

                function addSponsoredRowsFromNode(node, rows) {
                    const element = node instanceof Element ? node : node.parentElement;
                    if (!element) {
                        return;
                    }

                    const containingRow = element.closest('tr[role="row"]');
                    if (containingRow) {
                        rows.add(containingRow);
                    }

                    element.querySelectorAll(AD_INFO_SELECTOR).forEach(function(adInfo) {
                        const row = adInfo.closest('tr[role="row"]');
                        if (row) {
                            rows.add(row);
                        }
                    });
                }

                function scanSponsoredRows() {
                    const rows = new Set();
                    document.querySelectorAll(AD_INFO_SELECTOR).forEach(function(adInfo) {
                        const row = adInfo.closest('tr[role="row"]');
                        if (row) {
                            rows.add(row);
                        }
                    });
                    rows.forEach(handleSponsoredRow);
                }

                const pendingSponsoredRows = new Set();
                let sponsoredRowsScanPending = false;
                const sponsoredRowObserver = new MutationObserver(function(records) {
                    records.forEach(function(record) {
                        record.addedNodes.forEach(function(node) {
                            addSponsoredRowsFromNode(node, pendingSponsoredRows);
                        });
                    });

                    if (pendingSponsoredRows.size === 0 || sponsoredRowsScanPending) {
                        return;
                    }

                    sponsoredRowsScanPending = true;
                    requestAnimationFrame(function() {
                        sponsoredRowsScanPending = false;
                        pendingSponsoredRows.forEach(handleSponsoredRow);
                        pendingSponsoredRows.clear();
                    });
                });

                function startSponsoredRowObserver() {
                    scanSponsoredRows();
                    sponsoredRowObserver.observe(document.documentElement, {
                        childList: true,
                        subtree: true
                    });
                }

                if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", startSponsoredRowObserver, { once: true });
                } else {
                    startSponsoredRowObserver();
                }
			}

			if (document.location.href.match("outlook.live.")) {
				cssAdded = true;
				webmailName = "outlook";

				addC("#primaryContainer > div:not(._n_f)[style*='width: 160'], #primaryContainer > div:not(._n_f)[style*='width:160']", "display:none !important;right:0 !important");
				addC("#primaryContainer > div:not(._n_f)[style*='right: 160'], #primaryContainer > div:not(._n_f)[style*='right:160']", "right:0 !important");

				addC("#primaryContainer > div:not(._n_f)[style*='width: 165'], #primaryContainer > div:not(._n_f)[style*='width:165']", "display:none !important;right:0 !important");
				addC("#primaryContainer > div:not(._n_f)[style*='right: 165'], #primaryContainer > div:not(._n_f)[style*='right:165']", "right:0 !important");

				addC("#primaryContainer > div:not(._n_f)[style*='width: 305'], #primaryContainer > div:not(._n_f)[style*='width:305']", "display:none !important;right:0 !important");
				addC("#primaryContainer > div:not(._n_f)[style*='right: 305'], #primaryContainer > div:not(._n_f)[style*='right:305']", "right:0 !important");

				// bottom ad when window is resized narrow
				addC("#primaryContainer > div[style*='bottom: 95']", "bottom:0 !important");
				addC("#primaryContainer > div._n_h", "height:0 !important");

                // outlook.com v3 (old)
                hide("._3_hHr3kfEhbNYRFM5YJxH9"); // ads on right
				hide("._254GqExCxnOxmPy7kKATP2, .fbAdLoaded"); // when closing "Other" instead of "Focus"
                hide("._2OkJRYI946_Zzuy0TFJrpi"); // ad above "Other" section // .fbAdLink

                // outlook.com v4
                hide("._1fti_QgAzqGWPGlqh_FSvI"); // ads on right
                hide(".pBKjVBVDRKIDHWS0A95I"); // ads on right

                hide('._28ithXDZzMqSN0YAG2rCVn'); // hide Upgrade to Premium
                hide("._3MiSf0O_Y3kJsmYBJkL1dI"); // ad above "Other" section // .fbAdLink

                // v5
                hide(".pBKjV");
                hide(".aJ4OG"); // ads inside inbox
            
                hide(".full.cJ3F3"); // Firefox: 1st ad in inbox, updated css it in Oct 2022, updated css again in May 2023

                hide(".jYY8g"); // loading indicator (part 1)
                hide(".EeHm8:has(.kk1xx)"); // loading indicator (part 2)
                hide(".EeHm8:has(.Ogt7j)"); // hide ad after loading indicator (part 3)

                hide(".Z175s, .Ogqyq, .gcFPF"); // hide Upgrade to Premium

                hide("div[aria-label='advertisement']");
                hide(".GssDD"); // ff

                hide(".kk1xx"); // loading before
                hide(".Ogt7j"); // ad above inbox
			}

			if (document.location.href.match("mail.yahoo.")) {
				cssAdded = true;
				webmailName = "yahoo";
				
				hide("*[class*='ad_slug']"); /* welcome page ad, empty inbox ad etc. */
				hide("div[id='MNW']"); /* Classic Yahoo:Ad above folder */
				hide("div[id='northbanner']"); /* Classic Yahoo:top banner */
				hide("iframe[src*='http://ad.']"); /* Classic Yahoo:top banner in calendar */

				// Beta version
				hide("#theAd"); // right ad
                hide("#theMNWAd"); // ad above inbox says... Sahil Best - sexy_sam28@ymail.com
                
                addC("#shellcontent", "right:0 !important"); // right ad
                
				hide("#slot_LREC"); // What's new landing page ad
				hide("#slot_REC"); // left ad
				hide("#slot_MON"); // Spam box ad
				addC("#toolbar", "right:0 !important"); // right ad (stretches the toolbar)
				addC(".messagepane .right-ar", "right:0 !important"); // right arrow - for at&t yahoo

				// yahoo started using display:block !important   so i had to find an alternative to hiding by shrinking the size of div layer
				addC(".mb-rec-ad", "display:none !important; height:0 !important; border:none !important; overflow-x:hidden !important"); // ad in left column
				addC(".mb-list-ad", "display:none !important; height:0 !important; border:none !important; overflow-x:hidden !important"); // ad just above inbox
				
                hide("li[data-test-id='infinite-scroll-AD']"); // new add above inbox
                hide("[data-test-id='ad-viewability-tracker']"); // middle of inbox
				
				// Beta version (with page by page view option)
				addC("#main, #yucs, #yuhead-bucket", "max-width:none !important");
				addC(".fullpage #main, .fullpage #yucs, .fullpage #yuhead-bucket", "margin-right:0 !important");

				var foldersPane = document.getElementById("foldersPane");
				if (foldersPane) {
					var contentWidth = window.innerWidth - foldersPane.clientWidth - 10;
					hide("#welcomeAdsContainer"); /* On Home tab (welcome screen of yahoo mail */
					addC("#mainTabView", "width:" + contentWidth + "px !important");
					addC("#mainTablePane", "width:100% !important");
					addC(".PagedTableView_container", "width:100% !important");
					addC("div[id^='imcSession_']", "width:" + contentWidth + "px !important"); /* Text/Chat message window */
					hide("#ym-skyhider"); /* seperator for the right side area */
					hide("#largePane"); /* Right side wrapper */
					hide("#largeFrame"); /* Ad area */
					hide("#ym-skyscroller"); /* Ad scrolling arrow */
				}
				
				// Empty Spam folder - hide video ad
				hide("#emptyFolderVideo .videopane");
				addC(".wide-right-rail .frost-container", "right:0 !important");

                // empty Starrred folder
                hide("[data-test-id='video-container']");

                // empty folders
                hide("[data-test-id='gam-iframe']");

                /*
                // had to comment revert because this was hiding mails in the inbox, ref: candamilla@gmail.com
                const PENCIL_ATTRIBUTE = "[data-test-id*='pencil']";
				// Yahoo v2
                hide(`#Atom a${PENCIL_ATTRIBUTE}`);

                // after hiding above pencil ads, the following is to hide the empty space
                addC(`ul:has(li:nth-child(2)[style*='top: 0px'] ${PENCIL_ATTRIBUTE})`, "transform: translateY(-64px); transition: transform 0.2s ease-in-out;");
                */

                hide("#Atom a[data-test-id=pencil-ad]");
                hide("#Atom a[data-test-id*='pencil-ad-']");
                hide("#Atom a[data-test-id*='ad-pencil']");

				addC("div[data-test-id='comms-properties-bar']", "flex-direction: column !important;height: auto !important");
				addC("div[data-test-id='comms-properties']", "flex-direction: column !important;margin-top: 14px !important");
				addC("div[data-test-id='comms-properties'] > a", "margin-right: 0 !important; margin-bottom: 14px !important");
                
				hide("div[data-test-id='mail-right-rail'] div[data-test-id='contact-card']");
				hide("div[data-test-id='mail-right-rail'] div[data-test-id='message-read-contact-card']");
				hide("span[data-test-id='settings-link-label']");
                hide("div[data-test-id='right-rail-ad']");
                hide("div[data-test-id='right-rail-dpa-ad']");
                hide("li[data-test-id=infinite-scroll-PENCIL]");
                hide("div[data-test-id='mail-right-rail'] div[data-test-id='gam-iframe']");

                hide("#commerce_card_group_container"); // Deal summaries above emails

                //hide("ul[role='list'] > li:has(a[href*='api.taboola.com'])");
                hide("ul[role='list'] > li:has(a[rel='noreferrer'])"); // june 2026 more broad than above

                // align right side buttons
                css += " #Atom .M_Z1kd4S1 {margin-right:0}\n";

                // new yahoo - remove right side rail completely
                hide("#gpt-iframe-top_right");

                // contacts
                //hide("#Atom .W_3vpWV");

                // hide ads in the right rail
                hide("div[data-test-id='right-rail-container'] iframe");

                hide("#gpt-iframe");

                // bottom ad
                hide("div[data-test-id='leaderboard-ad']");

                if (await getStorageItem("yahoo-remove-right-side")) {
                    hide("[data-test-id='novation-right-rail']");
                    css += `
                        @media (min-width: 1500px) {
                            #Atom #mail-app-component-container {
                                grid-template-columns: min-content minmax(840px, 1fr) 10px !important;
                            }
                        }

                        @media (max-width: 1300px) {
                            #Atom #mail-app-component-container {
                                grid-template-columns: min-content minmax(640px, 1fr) 10px !important;
                            }
                        }

                        @media (min-width: 1301px) {
                            #Atom #mail-app-component-container {
                                grid-template-columns: min-content minmax(640px, 1fr) 10px !important;
                            }
                        }
                    `;
                }
			}
			
			if (cssAdded) {
				addStyle(css);
			}

            sendBlockingState(cssAdded, webmailName);
			
			return true;
		}
        sendBlockingState(false, null);
		return true;
	};
	init();
})();