import { requestUrl } from 'obsidian';

// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
const nodeHttps = require('https') as typeof import('https');
// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
const nodeHttp = require('http') as typeof import('http');

export interface HttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	finalUrl: string;
}

interface CookieEntry {
	value: string;
	domain: string;   // lowercased host, no leading dot
	hostOnly: boolean; // true when the Set-Cookie had no Domain attribute
}

/** Persisted cookie jar shape: domain → { cookieName → value }. */
export type CookieJar = Record<string, Record<string, string>>;

/**
 * HTTP client for the RWTH SSO flow.
 *
 * Uses Node's http/https modules directly so that we can manually track
 * redirects (and the final URL) — Obsidian's `requestUrl` auto-follows
 * redirects without exposing the final URL, which breaks the SSO flow
 * where we need to POST back to the IdP URL.
 *
 * `requestUrl` is still used for simple Moodle API calls (via `simpleGet`).
 */
export class HttpClient {
	private cookies: Map<string, CookieEntry> = new Map(); // key: `${domain}|${name}`

	// ----------------------------------------------------------------
	// Node-based request (used for SSO flow)
	// ----------------------------------------------------------------

	/**
	 * Make a single HTTP(S) request via Node without following redirects.
	 * Returns the raw status, headers, and body.
	 */
	private nodeRequest(
		url: string,
		method: string,
		body?: string,
		contentType?: string,
	): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
		const parsed = new URL(url);
		const isHttps = parsed.protocol === 'https:';
		const lib = isHttps ? nodeHttps : nodeHttp;

		const headers: Record<string, string> = {
			'User-Agent': 'ObsidianMoodlePlugin/1.0',
		};
		const cookieStr = this.getCookieString(parsed.hostname);
		if (cookieStr) headers['Cookie'] = cookieStr;
		if (body !== undefined && contentType) {
			headers['Content-Type'] = contentType;
			headers['Content-Length'] = String(new TextEncoder().encode(body).length);
		}

		return new Promise((resolve, reject) => {
			const req = lib.request(
				{
					hostname: parsed.hostname,
					port: parsed.port || (isHttps ? 443 : 80),
					path: parsed.pathname + parsed.search,
					method,
					headers,
				},
				(res) => {
					// eslint-disable-next-line no-undef
					const chunks: Buffer[] = [];
					// eslint-disable-next-line no-undef
					res.on('data', (chunk: Buffer) => chunks.push(chunk));
					res.on('end', () => {
						const respHeaders: Record<string, string> = {};
						for (const [key, val] of Object.entries(res.headers)) {
							if (typeof val === 'string') respHeaders[key] = val;
							else if (Array.isArray(val)) respHeaders[key] = val.join(', ');
						}
						// Handle set-cookie specially — keep as array-like for updateCookies
						const setCookies = res.headers['set-cookie'];
						if (setCookies) {
							(respHeaders as Record<string, unknown>)['set-cookie'] = setCookies;
						}
						this.updateCookies(respHeaders, parsed.hostname);

						resolve({
							statusCode: res.statusCode ?? 0,
							headers: respHeaders,
							// eslint-disable-next-line no-undef
						body: Buffer.concat(chunks).toString('utf-8'),
						});
					});
				},
			);
			req.on('error', reject);
			if (body !== undefined) req.write(body);
			req.end();
		});
	}

	/**
	 * Full request with manual redirect following. Tracks cookies and the
	 * final URL through the redirect chain.
	 */
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
			const resp = await this.nodeRequest(currentUrl, currentMethod, currentBody, currentContentType);

			if (
				followRedirects &&
				redirectCount < 15 &&
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

	// ----------------------------------------------------------------
	// Obsidian requestUrl (used for simple API calls, bypasses CORS)
	// ----------------------------------------------------------------

	async simpleGet(url: string): Promise<{ status: number; text: string }> {
		const resp = await requestUrl({ url, method: 'GET', throw: false });
		return { status: resp.status, text: resp.text };
	}

	// ----------------------------------------------------------------
	// Cookie management
	// ----------------------------------------------------------------

	/** Build the Cookie header for a request to `host`, scoped by domain. */
	getCookieString(host: string): string {
		if (this.cookies.size === 0) return '';
		const h = host.toLowerCase();
		const parts: string[] = [];
		for (const [key, entry] of this.cookies) {
			if (this.domainMatches(h, entry)) {
				const name = key.slice(key.indexOf('|') + 1);
				parts.push(`${name}=${entry.value}`);
			}
		}
		return parts.join('; ');
	}

	private domainMatches(host: string, entry: CookieEntry): boolean {
		if (entry.hostOnly) return host === entry.domain;
		return host === entry.domain || host.endsWith(`.${entry.domain}`);
	}

	private updateCookies(headers: Record<string, string>, requestHost: string): void {
		const rawValue: unknown = headers['set-cookie'] ?? headers['Set-Cookie'];
		if (!rawValue) return;

		let cookieStrings: string[];
		if (Array.isArray(rawValue)) {
			cookieStrings = rawValue as string[];
		} else if (typeof rawValue === 'string') {
			cookieStrings = rawValue.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
		} else {
			return;
		}

		const reqHost = requestHost.toLowerCase();
		for (const cookie of cookieStrings) {
			const segments = cookie.split(';');
			const nameValue = segments[0];
			if (!nameValue) continue;
			const eqIdx = nameValue.indexOf('=');
			if (eqIdx <= 0) continue;
			const name = nameValue.substring(0, eqIdx).trim();
			const value = nameValue.substring(eqIdx + 1).trim();

			// Scope the cookie: an explicit Domain attribute makes it a domain
			// cookie (subdomain-matchable); otherwise it's host-only.
			let domain = reqHost;
			let hostOnly = true;
			for (const attr of segments.slice(1)) {
				const eq = attr.indexOf('=');
				if (eq === -1) continue;
				if (attr.substring(0, eq).trim().toLowerCase() === 'domain') {
					const attrVal = attr.substring(eq + 1).trim();
					if (attrVal) {
						domain = attrVal.toLowerCase().replace(/^\./, '');
						hostOnly = false;
					}
				}
			}

			this.cookies.set(`${domain}|${name}`, { value, domain, hostOnly });
		}
	}

	exportCookies(): CookieJar {
		const out: CookieJar = {};
		for (const [key, entry] of this.cookies) {
			const name = key.slice(key.indexOf('|') + 1);
			(out[entry.domain] ??= {})[name] = entry.value;
		}
		return out;
	}

	importCookies(stored: CookieJar): void {
		for (const [domain, cookies] of Object.entries(stored)) {
			// Ignore a legacy flat { name: value } jar (no domain info) — the
			// values are strings, not objects, so a one-time re-login is needed.
			if (typeof cookies !== 'object' || cookies === null) continue;
			const d = domain.toLowerCase();
			for (const [name, value] of Object.entries(cookies)) {
				this.cookies.set(`${d}|${name}`, { value, domain: d, hostOnly: true });
			}
		}
	}

	clearCookies(): void {
		this.cookies.clear();
	}
}
