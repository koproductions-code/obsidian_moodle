import { MoodleCourse, MoodleSection, MoodleModule, MoodleContent } from './MoodleApi';
import type { FolderMapping } from './settings';

/** Where a file sits in the course tree, used to resolve its download folder. */
export interface FileLocation {
	courseId: number;
	sectionId?: number;
	moduleId?: number;
}

export type FileClickHandler = (filename: string, fileurl: string, location: FileLocation) => void;
export type CourseRenameHandler = (courseId: number, newName: string) => void;
export type CourseHideHandler = (courseId: number, hidden: boolean) => void;
/** Resolves to the new mapping (`path: null` = cleared), or `null` if cancelled. */
export type ConfigureMappingHandler = (key: string, label: string) => Promise<{ path: string | null } | null>;

export const mappingKeyForCourse = (courseId: number): string => `course:${courseId}`;
export const mappingKeyForSection = (sectionId: number): string => `section:${sectionId}`;
export const mappingKeyForModule = (moduleId: number): string => `module:${moduleId}`;

export interface TreeOptions {
	courseRenames: Record<string, string>;
	hiddenCourses: Record<string, boolean>;
	folderMappings: Record<string, FolderMapping>;
	showHidden: boolean;
	onExpandCourse: (course: MoodleCourse, detailsEl: HTMLDetailsElement) => void | Promise<void>;
	onFileClick: FileClickHandler;
	onCourseRename: CourseRenameHandler;
	onCourseHide: CourseHideHandler;
	onConfigureMapping: ConfigureMappingHandler;
}

/** Context passed down the section/module render tree. */
export interface RenderCtx {
	location: FileLocation;
	/** Human-readable Moodle ancestry (course → section → folder) for labels. */
	labelPath: string[];
	onFileClick: FileClickHandler;
	folderMappings: Record<string, FolderMapping>;
	onConfigureMapping: ConfigureMappingHandler;
}

/** Join a Moodle breadcrumb for display, e.g. "GGI 2 › Übungsblätter". */
function breadcrumb(labelPath: string[]): string {
	return labelPath.join(' › ');
}

const MODULE_ICONS: Record<string, string> = {
	resource: '📄',
	folder: '📁',
	url: '🔗',
	assign: '📝',
	quiz: '❓',
	forum: '💬',
	page: '📃',
	label: '🏷️',
};

function moduleIcon(modname: string): string {
	return MODULE_ICONS[modname] ?? '📦';
}

function getDownloadableContents(mod: MoodleModule): MoodleContent[] {
	return (mod.contents ?? []).filter(c => c.fileurl);
}

/**
 * Add a 📁 button to a course/section/folder summary that lets the user map it
 * to a vault download folder. Shows as active when a mapping exists.
 */
function addFolderButton(summary: HTMLElement, key: string, label: string, ctx: RenderCtx): void {
	const btn = summary.createEl('button', { cls: 'moodle-map-btn', text: '📁' });

	const apply = (path: string | undefined): void => {
		if (path) {
			btn.addClass('moodle-map-active');
			btn.title = `Downloads → ${path}`;
		} else {
			btn.removeClass('moodle-map-active');
			btn.title = 'Set download folder';
		}
	};
	apply(ctx.folderMappings[key]?.path);

	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		void (async () => {
			const result = await ctx.onConfigureMapping(key, label);
			if (!result) return; // cancelled
			apply(result.path ?? undefined);
		})();
	});
}

function buildFileEl(content: MoodleContent, ctx: RenderCtx): HTMLElement {
	const el = document.createElement('div');
	el.className = 'moodle-module';

	const link = el.createEl('a', { text: `📄 ${content.filename}`, cls: 'moodle-module-link' });
	link.addEventListener('click', (e) => {
		e.preventDefault();
		ctx.onFileClick(content.filename, content.fileurl, ctx.location);
	});

	return el;
}

function buildModuleEl(mod: MoodleModule, ctx: RenderCtx): HTMLElement {
	const files = getDownloadableContents(mod);

	// Folder with files → collapsible node listing each file, itself mappable.
	if (mod.modname === 'folder' && files.length > 0) {
		const moduleCtx: RenderCtx = {
			...ctx,
			location: { ...ctx.location, moduleId: mod.id },
			labelPath: [...ctx.labelPath, mod.name],
		};

		const details = document.createElement('details');
		details.className = 'moodle-section';

		const summary = details.createEl('summary', { cls: 'moodle-section-summary' });
		summary.createSpan({ text: `📁 ${mod.name}`, cls: 'moodle-section-name' });
		addFolderButton(summary, mappingKeyForModule(mod.id), breadcrumb(moduleCtx.labelPath), moduleCtx);

		for (const file of files) {
			details.appendChild(buildFileEl(file, moduleCtx));
		}

		return details;
	}

	const el = document.createElement('div');
	el.className = 'moodle-module';

	const icon = moduleIcon(mod.modname);

	// Single downloadable file → clickable
	if (files.length > 0) {
		const file = files[0]!;
		const link = el.createEl('a', { text: `${icon} ${mod.name}`, cls: 'moodle-module-link' });
		link.addEventListener('click', (e) => {
			e.preventDefault();
			ctx.onFileClick(file.filename, file.fileurl, ctx.location);
		});
	} else if (mod.url) {
		const a = el.createEl('a', { text: `${icon} ${mod.name}`, href: mod.url });
		a.target = '_blank';
		a.rel = 'noopener';
	} else {
		el.createSpan({ text: `${icon} ${mod.name}` });
	}

	return el;
}

function buildSectionEl(section: MoodleSection, ctx: RenderCtx): HTMLElement | null {
	const visibleModules = section.modules.filter(m => m.modname !== 'label');
	if (visibleModules.length === 0 && !section.name) return null;

	const name = section.name || `Section ${section.id}`;
	const sectionCtx: RenderCtx = {
		...ctx,
		location: { ...ctx.location, sectionId: section.id },
		labelPath: [...ctx.labelPath, name],
	};

	const details = document.createElement('details');
	details.className = 'moodle-section';

	const summary = details.createEl('summary', { cls: 'moodle-section-summary' });
	summary.createSpan({ text: name, cls: 'moodle-section-name' });
	addFolderButton(summary, mappingKeyForSection(section.id), breadcrumb(sectionCtx.labelPath), sectionCtx);

	for (const mod of visibleModules) {
		details.appendChild(buildModuleEl(mod, sectionCtx));
	}

	return details;
}

export function buildCourseTree(
	container: HTMLElement,
	courses: MoodleCourse[],
	sectionsMap: Map<number, MoodleSection[]>,
	opts: TreeOptions,
): void {
	container.empty();

	if (courses.length === 0) {
		container.createEl('p', { text: 'No courses found.' });
		return;
	}

	const isHidden = (c: MoodleCourse): boolean =>
		c.hidden || opts.hiddenCourses[String(c.id)] === true;

	const visibleCourses = opts.showHidden
		? courses
		: courses.filter(c => !isHidden(c));

	if (visibleCourses.length === 0) {
		container.createEl('p', { text: 'All courses are hidden.', cls: 'moodle-empty' });
		return;
	}

	for (const course of visibleCourses) {
		const displayName = opts.courseRenames[String(course.id)] ?? course.fullname;

		const courseCtx: RenderCtx = {
			location: { courseId: course.id },
			labelPath: [displayName],
			onFileClick: opts.onFileClick,
			folderMappings: opts.folderMappings,
			onConfigureMapping: opts.onConfigureMapping,
		};

		const details = document.createElement('details');
		details.className = 'moodle-course';

		const hidden = isHidden(course);
		if (hidden) details.addClass('moodle-course-hidden');

		const summary = details.createEl('summary', { cls: 'moodle-course-summary' });

		const nameSpan = summary.createSpan({ text: displayName, cls: 'moodle-course-name' });

		// Map-to-folder button
		addFolderButton(summary, mappingKeyForCourse(course.id), breadcrumb(courseCtx.labelPath), courseCtx);

		// Hide/show button
		const hideBtn = summary.createEl('button', {
			text: hidden ? '👁' : '🙈',
			cls: 'moodle-hide-btn',
			title: hidden ? 'Show course' : 'Hide course',
		});
		hideBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			opts.onCourseHide(course.id, !hidden);
		});

		// Right-click to rename
		nameSpan.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			startInlineRename(nameSpan, course, opts.courseRenames, opts.onCourseRename);
		});

		const contentEl = details.createDiv({ cls: 'moodle-course-content' });

		const sections = sectionsMap.get(course.id);
		if (sections) {
			renderSections(contentEl, sections, courseCtx);
		} else {
			const loading = contentEl.createEl('p', { text: 'Loading…', cls: 'moodle-loading' });
			// Not `{ once: true }`: if a load fails (sectionsMap stays unset), the
			// user can collapse and re-open the course to retry.
			let loadInflight = false;
			details.addEventListener('toggle', () => {
				if (details.open && !sectionsMap.has(course.id) && !loadInflight) {
					loadInflight = true;
					loading.setText('Loading…');
					void Promise.resolve(opts.onExpandCourse(course, details))
						.finally(() => { loadInflight = false; });
				}
			});
		}

		container.appendChild(details);
	}
}

function startInlineRename(
	nameSpan: HTMLElement,
	course: MoodleCourse,
	courseRenames: Record<string, string>,
	onCourseRename: CourseRenameHandler,
): void {
	const currentName = courseRenames[String(course.id)] ?? course.fullname;

	const input = document.createElement('input');
	input.type = 'text';
	input.value = currentName;
	input.className = 'moodle-rename-input';

	nameSpan.empty();
	nameSpan.appendChild(input);
	input.focus();
	input.select();

	const commit = () => {
		const newName = input.value.trim();
		input.remove();
		if (newName && newName !== course.fullname) {
			nameSpan.setText(newName);
			onCourseRename(course.id, newName);
		} else {
			nameSpan.setText(course.fullname);
			onCourseRename(course.id, '');
		}
	};

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			input.remove();
			nameSpan.setText(currentName);
		}
	});

	input.addEventListener('blur', commit);
}

export function renderSections(contentEl: HTMLElement, sections: MoodleSection[], ctx: RenderCtx): void {
	contentEl.empty();
	for (const section of sections) {
		const sectionEl = buildSectionEl(section, ctx);
		if (sectionEl) contentEl.appendChild(sectionEl);
	}
	if (contentEl.childElementCount === 0) {
		contentEl.createEl('p', { text: 'No content in this course.' });
	}
}
