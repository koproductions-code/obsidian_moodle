import { requestUrl } from 'obsidian';

export interface HttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	finalUrl: string;
}

/**
 * HTTP client using Obsidian's requestUrl (which bypasses CORS).
 * Tracks cookies across requests and handles redirects manually,
 * which is required for the RWTH Shibboleth SSO flow.
 */
export class HttpClient {
	private cookies: Map<string, string> = new Map();

	private async rawRequest(
		url: string,
		method: string,
		body?: string,
		contentType?: string,
	): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
		const headers: Record<string, string> = {
			'User-Agent': 'ObsidianMoodlePlugin/1.0',
		};

		const cookieStr = this.getCookieString();
		if (cookieStr) headers['Cookie'] = cookieStr;

		if (body !== undefined && contentType) {
			headers['Content-Type'] = contentType;
		}

		const resp = await requestUrl({
			url,
			method,
			headers,
			body: body ?? undefined,
			throw: false,
		});

		this.updateCookies(resp.headers);

		return {
			statusCode: resp.status,
			headers: resp.headers,
			body: resp.text,
		};
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

		for (;;) {
			const resp = await this.rawRequest(currentUrl, currentMethod, currentBody, currentContentType);

			if (
				followRedirects &&
				redirectCount < 10 &&
				[301, 302, 303, 307, 308].includes(resp.statusCode) &&
				resp.headers['location']
			) {
				redirectCount++;
				currentUrl = new URL(resp.headers['location'], currentUrl).toString();

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

	private updateCookies(headers: Record<string, string>): void {
		// Obsidian collapses multiple Set-Cookie headers into a single comma-separated string.
		// We split on commas that are followed by a cookie name=value pattern.
		const raw = headers['set-cookie'] ?? headers['Set-Cookie'];
		if (!raw) return;

		// Split on comma followed by a non-space word and '=' (heuristic for cookie boundaries)
		const parts = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
		for (const part of parts) {
			const nameValue = part.split(';')[0];
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
