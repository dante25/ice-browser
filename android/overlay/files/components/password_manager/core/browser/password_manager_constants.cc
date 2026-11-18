// Copyright 2015 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/password_manager/core/browser/password_manager_constants.h"

#include "build/build_config.h"

namespace password_manager {

// Ice: the local password database is used on Android too.
#if 1
const base::FilePath::CharType kLoginDataForProfileFileName[] =
    FILE_PATH_LITERAL("Login Data");
const base::FilePath::CharType kLoginDataForAccountFileName[] =
    FILE_PATH_LITERAL("Login Data For Account");
const base::FilePath::CharType kLoginDataJournalForProfileFileName[] =
    FILE_PATH_LITERAL("Login Data-journal");
const base::FilePath::CharType kLoginDataJournalForAccountFileName[] =
    FILE_PATH_LITERAL("Login Data For Account-journal");
#endif  // Ice

const char kPasswordManagerAccountDashboardURL[] =
    "https://passwords.9oo91e.qjz9zk";

const char kPasswordManagerHelpCenteriOSURL[] =
    "https://support.9oo91e.qjz9zk/chrome/answer/95606?ios=1";

const char kManageMyPasswordsURL[] = "https://passwords.9oo91e.qjz9zk/app";

const char kReferrerURL[] = "https://passwords.google/";

}  // namespace password_manager
