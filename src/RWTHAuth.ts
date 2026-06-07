import { HttpClient } from './httpClient';

const MOODLE_BASE = 'https://moodle.rwth-aachen.de';

export interface AuthResult {
	wstoken: string;
	userId: number;
	privateAccessKey: string;
	cookies: Record<string, string>;
	sessionKey: string;
}

function parseHTML(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

function extractSessionKey(html: string): string {
	const match = html.match(/"sesskey":"(.*?)"/);
	if (!match?.[1]) throw new Error('Could not find session key in Moodle page');
	return match[1];
}

function inputValue(doc: Document, name: string): string | null {
	const el = doc.querySelector(`input[name="${name}"]`);
	return el?.getAttribute('value') ?? null;
}

/**
 * Full RWTH SSO authentication flow, ported from syncmymoodle.
 *
 * 1. Navigate to Shibboleth login
 * 2. POST username + password
 * 3. Select TOTP generator
 * 4. Submit TOTP code
 * 5. POST SAML response back to Moodle
 * 6. Extract wstoken via mobile app launch page
 * 7. Get userId via site info API
 */
export async function authenticate(
	username: string,
	password: string,
	totpSerial: string,
	totpCode: string,
	cachedCookies?: Record<string, string>,
): Promise<AuthResult> {
	const client = new HttpClient();

	// Try cached session first
	if (cachedCookies && Object.keys(cachedCookies).length > 0) {
		client.importCookies(cachedCookies);
		try {
			const resp = await client.get(`${MOODLE_BASE}/my/`);
			if (resp.finalUrl.startsWith(`${MOODLE_BASE}/my`)) {
				const sessionKey = extractSessionKey(resp.body);
				const wstoken = await extractWsToken(client);
				const { userId, privateAccessKey } = await getUserInfo(client, wstoken);
				return {
					wstoken,
					userId,
					privateAccessKey,
					cookies: client.exportCookies(),
					sessionKey,
				};
			}
		} catch {
			// Cached session expired, proceed with full login
		}
		client.clearCookies();
	}

	// Step 1: Navigate to Shibboleth login page
	const shibResp = await client.get(`${MOODLE_BASE}/auth/shibboleth/index.php`);

	// Already logged in?
	if (shibResp.finalUrl.startsWith(`${MOODLE_BASE}/my`)) {
		const sessionKey = extractSessionKey(shibResp.body);
		const wstoken = await extractWsToken(client);
		const { userId, privateAccessKey } = await getUserInfo(client, wstoken);
		return { wstoken, userId, privateAccessKey, cookies: client.exportCookies(), sessionKey };
	}

	let doc = parseHTML(shibResp.body);

	// Check for maintenance
	const bodyText = doc.body?.textContent ?? '';
	if (bodyText.includes('Wartungsarbeiten')) {
		throw new Error('Moodle is in maintenance mode. Try again later.');
	}

	// If we already have a SAML response (unlikely at this point), skip to SAML POST
	if (inputValue(doc, 'RelayState')) {
		return completeSAMLLogin(client, doc);
	}

	// Step 2: Submit credentials
	const csrf1 = inputValue(doc, 'csrf_token');
	if (!csrf1) throw new Error('Could not find csrf_token on SSO login page');

	const loginResp = await client.postForm(shibResp.finalUrl, {
		j_username: username,
		j_password: password,
		_eventId_proceed: '',
		csrf_token: csrf1,
	});

	doc = parseHTML(loginResp.body);

	// Step 3: Select TOTP generator
	if (!doc.querySelector('#fudis_selected_token_ids_input')) {
		throw new Error(
			'Login failed — wrong credentials, or the RWTH SSO server is having issues. ' +
			'Check https://maintenance.rz.rwth-aachen.de/ticket/status/messages'
		);
	}

	const csrf2 = inputValue(doc, 'csrf_token');
	if (!csrf2) throw new Error('Could not find csrf_token on TOTP selection page');

	const totpSelectResp = await client.postForm(loginResp.finalUrl, {
		fudis_selected_token_ids_input: totpSerial,
		_eventId_proceed: '',
		csrf_token: csrf2,
	});

	doc = parseHTML(totpSelectResp.body);

	// Step 4: Submit TOTP code
	if (!doc.querySelector('#fudis_otp_input')) {
		throw new Error('TOTP generator selection failed — wrong serial number?');
	}

	const csrf3 = inputValue(doc, 'csrf_token');
	if (!csrf3) throw new Error('Could not find csrf_token on TOTP input page');

	const totpResp = await client.postForm(totpSelectResp.finalUrl, {
		fudis_otp_input: totpCode,
		_eventId_proceed: '',
		csrf_token: csrf3,
	});

	doc = parseHTML(totpResp.body);

	// Step 5: Submit SAML response back to Moodle
	return completeSAMLLogin(client, doc);
}

async function completeSAMLLogin(client: HttpClient, doc: Document): Promise<AuthResult> {
	const relayState = inputValue(doc, 'RelayState');
	const samlResponse = inputValue(doc, 'SAMLResponse');

	if (!relayState || !samlResponse) {
		throw new Error(
			'Login failed — could not find SAML response. ' +
			'Check your TOTP code and try again.'
		);
	}

	const resp = await client.postForm(`${MOODLE_BASE}/Shibboleth.sso/SAML2/POST`, {
		RelayState: relayState,
		SAMLResponse: samlResponse,
	});

	const sessionKey = extractSessionKey(resp.body);
	const wstoken = await extractWsToken(client);
	const { userId, privateAccessKey } = await getUserInfo(client, wstoken);

	return {
		wstoken,
		userId,
		privateAccessKey,
		cookies: client.exportCookies(),
		sessionKey,
	};
}

/**
 * Extract wstoken by hitting the mobile app launch page.
 * The server responds with a redirect to moodlemobile://token=BASE64
 * where the BASE64 decodes to "SOMETHING:::WSTOKEN".
 */
async function extractWsToken(client: HttpClient): Promise<string> {
	const params = new URLSearchParams({
		service: 'moodle_mobile_app',
		passport: '1',
		urlscheme: 'moodlemobile',
	});

	const resp = await client.get(
		`${MOODLE_BASE}/admin/tool/mobile/launch.php?${params.toString()}`,
		false, // Don't follow — redirect goes to moodlemobile:// scheme
	);

	const location = resp.headers['location'];
	if (!location) {
		throw new Error('Mobile launch page did not return a redirect. Is the mobile app service enabled?');
	}

	const tokenMatch = location.match(/token=([A-Za-z0-9+/=]+)/);
	if (!tokenMatch?.[1]) throw new Error('Could not find token in mobile launch redirect');

	const decoded = atob(tokenMatch[1]);
	const parts = decoded.split(':::');
	if (parts.length < 2 || !parts[1]) throw new Error('Invalid token format from mobile launch');

	return parts[1];
}

async function getUserInfo(
	client: HttpClient,
	wstoken: string,
): Promise<{ userId: number; privateAccessKey: string }> {
	const resp = await client.postForm(
		`${MOODLE_BASE}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info`,
		{
			moodlewssettingfilter: 'true',
			moodlewssettingfileurl: 'true',
			wsfunction: 'core_webservice_get_site_info',
			wstoken,
		},
	);

	const data = JSON.parse(resp.body) as {
		userid?: number;
		userprivateaccesskey?: string;
		exception?: string;
		message?: string;
	};

	if (data.exception) {
		throw new Error(data.message ?? data.exception);
	}
	if (!data.userid || !data.userprivateaccesskey) {
		throw new Error('Failed to retrieve user info from Moodle');
	}

	return { userId: data.userid, privateAccessKey: data.userprivateaccesskey };
}
