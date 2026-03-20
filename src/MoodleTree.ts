import { MoodleCourse, MoodleSection, MoodleModule, MoodleContent } from './MoodleApi';

export type FileClickHandler = (filename: string, fileurl: string) => void;
export type CourseRenameHandler = (courseId: number, newName: string) => void;
export type CourseHideHandler = (courseId: number, hidden: boolean) => void;

export interface TreeOptions {
	courseRenames: Record<string, string>;
	hiddenCourses: Record<string, boolean>;
	showHidden: boolean;
	onExpandCourse: (course: MoodleCourse, detailsEl: HTMLDetailsElement) => void;
	onFileClick: FileClickHandler;
	onCourseRename: CourseRenameHandler;
	onCourseHide: CourseHideHandler;
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

function buildFileEl(content: MoodleContent, onFileClick: FileClickHandler): HTMLElement {
	const el = document.createElement('div');
	el.className = 'moodle-module';

	const link = el.createEl('a', { text: `📄 ${content.filename}`, cls: 'moodle-module-link' });
	link.addEventListener('click', (e) => {
		e.preventDefault();
		onFileClick(content.filename, content.fileurl);
	});

	return el;
}

function buildModuleEl(mod: MoodleModule, onFileClick: FileClickHandler): HTMLElement {
	const files = getDownloadableContents(mod);

	// Folder with files → collapsible node listing each file
	if (mod.modname === 'folder' && files.length > 0) {
		const details = document.createElement('details');
		details.className = 'moodle-section';

		const summary = details.createEl('summary', {
			text: `📁 ${mod.name}`,
		});
		summary.className = 'moodle-section-summary';

		for (const file of files) {
			details.appendChild(buildFileEl(file, onFileClick));
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
			onFileClick(file.filename, file.fileurl);
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

function buildSectionEl(section: MoodleSection, onFileClick: FileClickHandler): HTMLElement | null {
	const visibleModules = section.modules.filter(m => m.modname !== 'label');
	if (visibleModules.length === 0 && !section.name) return null;

	const details = document.createElement('details');
	details.className = 'moodle-section';

	const summary = details.createEl('summary', {
		text: section.name || `Section ${section.id}`,
	});
	summary.className = 'moodle-section-summary';

	for (const mod of visibleModules) {
		details.appendChild(buildModuleEl(mod, onFileClick));
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
		const details = document.createElement('details') as HTMLDetailsElement;
		details.className = 'moodle-course';

		const hidden = isHidden(course);
		if (hidden) details.addClass('moodle-course-hidden');

		const displayName = opts.courseRenames[String(course.id)] ?? course.fullname;
		const summary = details.createEl('summary', { cls: 'moodle-course-summary' });

		const nameSpan = summary.createSpan({ text: displayName, cls: 'moodle-course-name' });

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
			renderSections(contentEl, sections, opts.onFileClick);
		} else {
			const loading = contentEl.createEl('p', { text: 'Loading…', cls: 'moodle-loading' });
			details.addEventListener('toggle', () => {
				if (details.open && !sectionsMap.has(course.id)) {
					loading.setText('Loading…');
					opts.onExpandCourse(course, details);
				}
			}, { once: true });
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

export function renderSections(contentEl: HTMLElement, sections: MoodleSection[], onFileClick: FileClickHandler): void {
	contentEl.empty();
	for (const section of sections) {
		const sectionEl = buildSectionEl(section, onFileClick);
		if (sectionEl) contentEl.appendChild(sectionEl);
	}
	if (contentEl.childElementCount === 0) {
		contentEl.createEl('p', { text: 'No content in this course.' });
	}
}
