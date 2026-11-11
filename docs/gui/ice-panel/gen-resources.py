import sys
"""Usage: gen-resources.py <src>/chrome/browser/ui/webui/ice/ice_panel_resources.h (embeds panel.html/css/js)."""
import os
W=os.path.dirname(os.path.abspath(__file__))+'/'
out=sys.argv[1]
parts=[]
for var,f in [('kIcePanelHtml','panel.html'),('kIcePanelCss','panel.css'),('kIcePanelJs','panel.js')]:
    t=open(W+f,encoding='utf-8').read()
    assert ')ICE"' not in t
    parts.append(f'inline constexpr char {var}[] = R"ICE({t})ICE";\n')
hdr='''// Copyright 2026 The Ice Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// The chrome://ice-panel page (HTML/CSS/JS), compiled in so no grit/grd or
// build_webui step is needed. Generated from the sources kept in the Ice repo
// (docs/gui/ice-panel/); edit those and regenerate.

#ifndef CHROME_BROWSER_UI_WEBUI_ICE_ICE_PANEL_RESOURCES_H_
#define CHROME_BROWSER_UI_WEBUI_ICE_ICE_PANEL_RESOURCES_H_

namespace ice {

'''
open(out,'w',encoding='utf-8').write(hdr+'\n'.join(parts)+'''
}  // namespace ice

#endif  // CHROME_BROWSER_UI_WEBUI_ICE_ICE_PANEL_RESOURCES_H_
''')
