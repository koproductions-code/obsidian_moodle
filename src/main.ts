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

		this.addRibbonIcon('graduation-cap', 'Moodle courses', async () => {
			// If not authenticated, try logging in first
			if (!this.settings.wstoken) {
				const ok = await this.performLogin();
				if (!ok) return;
			}
			await this.activateView();
		});

		this.addCommand({
			id: 'open-sidebar',
			name: 'Open courses sidebar',
			callback: () => { void this.activateView(); },
		});

		this.addCommand({
			id: 'login',
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- RWTH and Moodle are proper nouns
			name: 'Login to RWTH Moodle',
			callback: () => { void this.performLogin(); },
		});

		this.addSettingTab(new MoodleSettingTab(this.app, this));
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
		void workspace.revealLeaf(leaf);
	}

	/**
	 * Run the full RWTH SSO authentication flow.
	 * If totpSecret is configured, TOTP is auto-generated.
	 * Otherwise, a modal prompts the user for a code.
	 */
	async performLogin(): Promise<boolean> {
		const { username, password, totpSerial, totpSecret } = this.settings;

		if (!username || !password || !totpSerial) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- RWTH is an acronym
			new Notice('Please configure RWTH credentials in settings.');
			return false;
		}

		let totpCode: string;
		if (totpSecret) {
			totpCode = await totp(totpSecret);
		} else {
			const code = await promptTotp(this.app, totpSerial);
			if (!code) {
				new Notice('Login cancelled.');
				return false;
			}
			totpCode = code;
		}

		try {
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- RWTH and Moodle are proper nouns
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

			// eslint-disable-next-line obsidianmd/ui/sentence-case -- proper nouns
			new Notice('Connected to RWTH Moodle!');
			return true;
		} catch (e) {
			new Notice(`Login failed: ${(e as Error).message}`);
			return false;
		}
	}
}
