import { readFileSync, writeFileSync } from 'fs';
import { IdGenerator, ApprovalStatus } from './gen';

const RE_PRIVATE = /^_private__/;

///////////////////////////////////////////////////
//              Ad-hoc tokenization              //
// This is an ugly prototype, so I didn't bother //
//  messing with AST yet. But it should be done, //
//                    later,                     //
//                                   probably.   //
///////////////////////////////////////////////////
const chunks = readFileSync(process.argv[2], 'utf-8').split(/([$_a-z][$_a-z0-9]*)/i);
///////////////////////////////////////////////////

// Stats of private propnames occured
const mangleStats: Record<string, number> = Object.create(null);

// Custom implementation of the basic class
class BlacklistingIdGenerator extends IdGenerator {
	public dontMangle: Set<string> = new Set();

	protected _approveId(name: Uint8Array): ApprovalStatus {
		const str = Buffer.from(name).toString();
		if (this.dontMangle.has(str)) {
			return ApprovalStatus.Skip;
		}
		return super._approveId(name);
	}
}

const idgen = new BlacklistingIdGenerator();

for (const chunk of chunks) {
	if (RE_PRIVATE.test(chunk)) {
		if (chunk in mangleStats) {
			mangleStats[chunk]++;
		} else {
			mangleStats[chunk] = 1;
		}
	} else {
		idgen.dontMangle.add(chunk);
		idgen.appendAmbience(Buffer.from(chunk));
	}
}

// We're done with stats and a blacklist,
// now it can be inititalized
idgen.init();

// Sort the keys, so the more often occuring propnames
// get the shorter ids
const keys = Object.keys(mangleStats);
keys.sort((a, b) => mangleStats[b] - mangleStats[a]);

for (const chunk of keys) {
	const occurence = mangleStats[chunk];
	const newId = Buffer.from(idgen.generate(occurence)).toString();
	process.stderr.write(`[${occurence}] ${chunk} -> ${newId}\n`);
	for (let i = 0; i < chunks.length; i++) {
		if (chunks[i] === chunk) {
			chunks[i] = newId;
		}
	}
}

process.stdout.write(chunks.join(''));
