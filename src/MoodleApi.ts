import { requestUrl } from 'obsidian';

const MOODLE_BASE = 'https://moodle.rwth-aachen.de';

export interface MoodleCourse {
	id: number;
	shortname: string;
	fullname: string;
	summary: string;
	idnumber: string;
	hidden: boolean;
}

export interface MoodleModule {
	id: number;
	name: string;
	modname: string;
	url?: string;
	contents?: MoodleContent[];
}

export interface MoodleContent {
	type: string;
	filename: string;
	fileurl: string;
}

export interface MoodleSection {
	id: number;
	name: string;
	modules: MoodleModule[];
}

async function moodlePost(
	wstoken: string,
	wsfunction: string,
	extraParams: Record<string, string | number> = {},
): Promise<unknown> {
	const urlParams = new URLSearchParams({
		moodlewsrestformat: 'json',
		wsfunction,
	});

	const bodyParams = new URLSearchParams({
		wstoken,
		wsfunction,
		moodlewssettingfilter: 'true',
		moodlewssettingfileurl: 'true',
	});

	for (const [k, v] of Object.entries(extraParams)) {
		bodyParams.set(k, String(v));
	}

	const resp = await requestUrl({
		url: `${MOODLE_BASE}/webservice/rest/server.php?${urlParams.toString()}`,
		method: 'POST',
		contentType: 'application/x-www-form-urlencoded',
		body: bodyParams.toString(),
		throw: false,
	});

	if (resp.status >= 400) {
		throw new Error(`Moodle API HTTP ${resp.status}`);
	}

	const data = resp.json as { exception?: string; message?: string };
	if (data && typeof data === 'object' && 'exception' in data) {
		throw new Error(data.message ?? data.exception ?? 'Moodle API error');
	}

	return data;
}

/**
 * Get all courses the user is enrolled in.
 * Uses tool_mobile_call_external_functions wrapper, matching syncmymoodle.
 */
export async function getCourses(wstoken: string, userId: number): Promise<MoodleCourse[]> {
	const data = await moodlePost(wstoken, 'tool_mobile_call_external_functions', {
		'requests[0][function]': 'core_enrol_get_users_courses',
		'requests[0][arguments]': JSON.stringify({ userid: String(userId), returnusercount: '0' }),
		'requests[0][settingfilter]': 1,
		'requests[0][settingfileurl]': 1,
	}) as { responses: Array<{ data: string; error: boolean }> };

	const first = data.responses[0];
	if (!first || first.error) {
		throw new Error('Failed to fetch courses');
	}

	const raw = JSON.parse(first.data) as Array<
		Omit<MoodleCourse, 'hidden'> & { hidden?: boolean | number | string }
	>;

	return raw.map(c => ({
		...c,
		hidden: c.hidden === true || c.hidden === 1 || c.hidden === '1' || c.hidden === 'true',
	}));
}

/**
 * Get sections and modules for a specific course.
 */
export async function getCourseContents(wstoken: string, courseId: number): Promise<MoodleSection[]> {
	const data = await moodlePost(wstoken, 'core_course_get_contents', {
		courseid: courseId,
	});
	return data as MoodleSection[];
}

/**
 * Download a file from Moodle by appending the wstoken to its pluginfile URL.
 */
export async function downloadFile(wstoken: string, fileUrl: string): Promise<ArrayBuffer> {
	const separator = fileUrl.includes('?') ? '&' : '?';
	const url = `${fileUrl}${separator}token=${wstoken}`;

	const resp = await requestUrl({ url, method: 'GET', throw: false });
	if (resp.status >= 400) {
		throw new Error(`Download failed: HTTP ${resp.status}`);
	}
	return resp.arrayBuffer;
}