import * as crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
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

	return Buffer.from(bytes);
}

function hotp(key: string, counter: number, digits = 6): string {
	const paddedKey = key.toUpperCase() + '='.repeat((8 - (key.length % 8)) % 8);
	const keyBuffer = base32Decode(paddedKey);

	const counterBuffer = Buffer.alloc(8);
	counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
	counterBuffer.writeUInt32BE(counter >>> 0, 4);

	const mac = crypto.createHmac('sha1', keyBuffer).update(counterBuffer).digest();

	const offset = mac[mac.length - 1]! & 0x0f;
	const binary =
		((mac[offset]! & 0x7f) << 24) |
		((mac[offset + 1]! & 0xff) << 16) |
		((mac[offset + 2]! & 0xff) << 8) |
		(mac[offset + 3]! & 0xff);

	return (binary % Math.pow(10, digits)).toString().padStart(digits, '0');
}

export function totp(key: string, timeStep = 30, digits = 6): string {
	const counter = Math.floor(Date.now() / 1000 / timeStep);
	return hotp(key, counter, digits);
}
