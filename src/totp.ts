const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
	const clean = input.replace(/=+$/, '');

	let bits = '';
	for (const char of clean) {
		const val = BASE32_ALPHABET.indexOf(char);
		if (val === -1) throw new Error(`Invalid base32 character: ${char}`);
		bits += val.toString(2).padStart(5, '0');
	}

	const bytes: number[] = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(parseInt(bits.substring(i, i + 8), 2));
	}

	return new Uint8Array(bytes);
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
	return new Uint8Array(sig);
}

async function hotp(key: string, counter: number, digits = 6): Promise<string> {
	const paddedKey = key.toUpperCase() + '='.repeat((8 - (key.length % 8)) % 8);
	const keyBuffer = base32Decode(paddedKey);

	const counterBuffer = new ArrayBuffer(8);
	const view = new DataView(counterBuffer);
	view.setUint32(0, Math.floor(counter / 0x100000000));
	view.setUint32(4, counter >>> 0);

	const mac = await hmacSha1(keyBuffer, new Uint8Array(counterBuffer));

	const offset = mac[mac.length - 1]! & 0x0f;
	const binary =
		((mac[offset]! & 0x7f) << 24) |
		((mac[offset + 1]! & 0xff) << 16) |
		((mac[offset + 2]! & 0xff) << 8) |
		(mac[offset + 3]! & 0xff);

	return (binary % Math.pow(10, digits)).toString().padStart(digits, '0');
}

export async function totp(key: string, timeStep = 30, digits = 6): Promise<string> {
	const counter = Math.floor(Date.now() / 1000 / timeStep);
	return hotp(key, counter, digits);
}
