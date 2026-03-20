import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, MoodlePluginSettings, MoodleSettingTab } from './settings';
import { MoodleView, MOODLE_VIEW_TYPE } from './MoodleView';
import { authenticate } from './RWTHAuth';
import { totp } from './totp';
import { promptTotp } from './TotpModal';

export default class MoodlePlugin extends Plugin {
	settings: MoodlePluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(MOODLE_VIEW_TYPE, (leaf) => new MoodleView(leaf, this));

		this.addRibbonIcon('graduation-cap', 'Moodle Courses', async () => {
			// If not authenticated, try logging in first
			if (!this.settings.wstoken) {
				const ok = await this.performLogin();
				if (!ok) return;
			}
			this.activateView();
		});

		this.addCommand({
			id: 'open-moodle-courses',
			name: 'Open Moodle Courses sidebar',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'moodle-login',
			name: 'Login to RWTH Moodle',
			callback: () => this.performLogin(),
		});

		this.addSettingTab(new MoodleSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(MOODLE_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MoodlePluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(MOODLE_VIEW_TYPE)[0];
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			leaf = rightLeaf ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: MOODLE_VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	/**
	 * Run the full RWTH SSO authentication flow.
	 * If totpSecret is configured, TOTP is auto-generated.
	 * Otherwise, a modal prompts the user for a code.
	 */
	async performLogin(): Promise<boolean> {
		const { username, password, totpSerial, totpSecret } = this.settings;

		if (!username || !password || !totpSerial) {
			new Notice('Please configure RWTH credentials in Settings → Moodle Courses.');
			return false;
		}

		let totpCode: string;
		if (totpSecret) {
			totpCode = totp(totpSecret);
		} else {
			const code = await promptTotp(this.app, totpSerial);
			if (!code) {
				new Notice('Login cancelled.');
				return false;
			}
			totpCode = code;
		}

		try {
			new Notice('Logging in to RWTH Moodle…');
			const result = await authenticate(
				username,
				password,
				totpSerial,
				totpCode,
				this.settings.cookies,
			);

			this.settings.wstoken = result.wstoken;
			this.settings.userId = result.userId;
			this.settings.cookies = result.cookies;
			this.settings.sessionKey = result.sessionKey;
			await this.saveSettings();

			new Notice('Connected to RWTH Moodle!');
			return true;
		} catch (e) {
			new Notice(`Login failed: ${(e as Error).message}`);
			return false;
		}
	}
}
