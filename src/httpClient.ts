import * as https from 'https';
import * as http from 'http';

export interface HttpResponse {
	statusCode: number;
	headers: http.IncomingHttpHeaders;
	body: string;
	finalUrl: string;
}

/**
 * Minimal HTTP client using Node's https/http modules.
 * Tracks cookies across requests and handles redirects manually,
 * which is required for the RWTH Shibboleth SSO flow.
 */
export class HttpClient {
	private cookies: Map<string, string> = new Map();

	private rawRequest(
		url: string,
		method: string,
		body?: string,
		contentType?: string,
	): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
		const parsed = new URL(url);
		const lib = parsed.protocol === 'https:' ? https : http;

		const reqHeaders: Record<string, string> = {
			'User-Agent': 'ObsidianMoodlePlugin/1.0',
		};

		const cookieStr = this.getCookieString();
		if (cookieStr) reqHeaders['Cookie'] = cookieStr;

		if (body !== undefined) {
			reqHeaders['Content-Type'] = contentType ?? 'application/x-www-form-urlencoded';
			reqHeaders['Content-Length'] = Buffer.byteLength(body).toString();
		}

		return new Promise((resolve, reject) => {
			const req = lib.request(
				{
					hostname: parsed.hostname,
					port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
					path: parsed.pathname + parsed.search,
					method,
					headers: reqHeaders,
				},
				(res) => {
					this.updateCookies(res.headers);

					const chunks: Buffer[] = [];
					res.on('data', (chunk: Buffer) => chunks.push(chunk));
					res.on('end', () => {
						resolve({
							statusCode: res.statusCode ?? 0,
							headers: res.headers,
							body: Buffer.concat(chunks).toString('utf-8'),
						});
					});
					res.on('error', reject);
				},
			);
			req.on('error', reject);
			if (body !== undefined) req.write(body);
			req.end();
		});
	}

	async request(
		url: string,
		method = 'GET',
		body?: string,
		contentType?: string,
		followRedirects = true,
	): Promise<HttpResponse> {
		let currentUrl = url;
		let currentMethod = method;
		let currentBody = body;
		let currentContentType = contentType;
		let redirectCount = 0;

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const resp = await this.rawRequest(currentUrl, currentMethod, currentBody, currentContentType);

			if (
				followRedirects &&
				redirectCount < 10 &&
				[301, 302, 303, 307, 308].includes(resp.statusCode) &&
				resp.headers.location
			) {
				redirectCount++;
				currentUrl = new URL(resp.headers.location, currentUrl).toString();

				// 303 or POST with 301/302 → switch to GET
				if (
					resp.statusCode === 303 ||
					(currentMethod === 'POST' && [301, 302].includes(resp.statusCode))
				) {
					currentMethod = 'GET';
					currentBody = undefined;
					currentContentType = undefined;
				}
				continue;
			}

			return { ...resp, finalUrl: currentUrl };
		}
	}

	async get(url: string, followRedirects = true): Promise<HttpResponse> {
		return this.request(url, 'GET', undefined, undefined, followRedirects);
	}

	async postForm(
		url: string,
		data: Record<string, string>,
		followRedirects = true,
	): Promise<HttpResponse> {
		const body = Object.entries(data)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join('&');
		return this.request(url, 'POST', body, 'application/x-www-form-urlencoded', followRedirects);
	}

	getCookieString(): string {
		if (this.cookies.size === 0) return '';
		return Array.from(this.cookies.entries())
			.map(([k, v]) => `${k}=${v}`)
			.join('; ');
	}

	private updateCookies(headers: http.IncomingHttpHeaders): void {
		const setCookies = headers['set-cookie'];
		if (!setCookies) return;
		for (const raw of setCookies) {
			const nameValue = raw.split(';')[0];
			if (!nameValue) continue;
			const eqIdx = nameValue.indexOf('=');
			if (eqIdx <= 0) continue;
			this.cookies.set(
				nameValue.substring(0, eqIdx).trim(),
				nameValue.substring(eqIdx + 1).trim(),
			);
		}
	}

	exportCookies(): Record<string, string> {
		return Object.fromEntries(this.cookies);
	}

	importCookies(cookies: Record<string, string>): void {
		for (const [k, v] of Object.entries(cookies)) {
			this.cookies.set(k, v);
		}
	}

	clearCookies(): void {
		this.cookies.clear();
	}
}
