// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { EnvelopeSimpleIcon } from "@phosphor-icons/react";

export default function EmptyReadingPane() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 text-kumo-subtle select-none">
			<EnvelopeSimpleIcon size={40} weight="thin" />
			<p className="text-sm">Select an email to read</p>
		</div>
	);
}
