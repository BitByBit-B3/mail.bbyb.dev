// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	APP_PASSWORD: string;
	R2_S3_ACCESS_KEY_ID: string;
	R2_S3_SECRET_ACCESS_KEY: string;
}
