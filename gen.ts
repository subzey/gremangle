export const enum ApprovalStatus {
	/** id is valid and can be used */
	Ok = 0,
	/** this id cannot be used */
	Skip,
	/** this id and any string that starts with it cannot be used*/
	SkipTree
}

/** Use Shannon entropy to estimate total compressed bit length */
function getInformationContent(occurences: Readonly<Uint32Array>): number {
	let partials = 0;
	let total = 0;

	// The Shannon entropy formula is sum( (occurence / total) * log2(occurence / total) )
	// Multiplied by total it gives the total information content in bits
	// After some maths we get this:

	for (let byteValue = 0; byteValue < 256; byteValue++) {
		let occurence = occurences[byteValue];
		if (occurence > 0) {
			partials += occurence * Math.log2(occurence);
			total += occurence;
		}
	}

	return total * Math.log2(total) - partials;
}

export class IdGenerator {
	/** The list of id candidates */
	private _state?: Uint8Array[];
	/** Occurence stats from the ambient context */
	private _ambienceStats = new Uint32Array(256);
	/** Ready to generate */
	private _inited = false;

	/**
	 * Bytes that can make identifiers: $_A-Za-z0-9
	 * Overridable.
	 */
	protected readonly _idBytes: Readonly<Uint8Array> = new Uint8Array([
		36, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 65, 66, 67, 68, 69, 70, 71,
		72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
		90, 95, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
		110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122
	]);

	/**
	 * Extracts the given id candidate and replace it with the next tree layer:
	 * Ex: extract "a" and replaceit with "a$", "aA", ... "az"
	 * At any time the list contains only valid id candidates
	 */
	private _expandState(expandedLeaf: Uint8Array, state: Uint8Array[]): void {
		// This stuff can be represened as a tree,
		// but we're only interested in the leaf nodes
		// so we use a flat list instead.

		const index = state.indexOf(expandedLeaf);
		if (index === -1) {
			throw new Error('leaf is not contained in the state');
		}
		let replacement: Uint8Array[] = [];
		for (let i = 0; i < this._idBytes.length; i++) {
			// a -> a$ ... a_
			const newLeaf = new Uint8Array(expandedLeaf.length + 1);
			newLeaf.set(expandedLeaf);
			newLeaf[newLeaf.length - 1] = this._idBytes[i];

			// Determine if this is a valid id
			const approvalStatus = this._approveId(newLeaf);

			if (approvalStatus === ApprovalStatus.SkipTree) {
				// Nope, and nothing that start with it cannot be used
				// Ex: "__" or "7"
				continue;
			}
			replacement.push(newLeaf);
			if (approvalStatus === ApprovalStatus.Skip) {
				// This exact id cannot be used
				// Ex: "hasOwnProperty"
				// Remove this candidate and replace it with the next layer:
				// i.e., call this function recursively
				this._expandState(newLeaf, replacement);
			}
		}
		// Replace the old one with the new ones
		state.splice(index, 1, ...replacement);
	}

	/** Probably won't ever be called */
	public resetAmbience(): void {
		this._ambienceStats.fill(0);
	}

	/**
	 * Some stats about the ambient context.
	 * Ex: If the source is `const <give me name> = "abracadabra"`,
	 * it's useful to know "a" is encountered 5 times.
	 * In fact, using ambient context is the core idea of this project.
	 */
	public appendAmbience(ambienceChunk: Uint8Array, count=1) {
		// ambienceStats is an array of length 256
		// Ex: ambienceStats[42] stores the number of the
		// byte with value 42 (ASCII "*") encountered
		for (let i = 0; i < ambienceChunk.length; i++) {
			this._ambienceStats[ambienceChunk[i]] += count;
		}
	}

	/**
	 * Decides if the id valid.
	 * Id is a Uint8Array, not string for two reasons:
	 * - Compressors typically works with bytes and they don't know
	 *   if this a string or binary.
	 * - Possible extensions. You would like to have Cyrillic or Emoji
	 *   identifiers, wouldn't you?
	 *
	 * Override this method to get your own black/white list
	 * of identifiers.
	 */
	protected _approveId(id: Uint8Array): ApprovalStatus {
		// Starts with a digit: No way!
		if (id.length >= 1 && id[0] >= 0x30 && id[0] <= 0x39) {
			return ApprovalStatus.SkipTree;
		}
		// Starts with a double undersore: Better not.
		if (id.length >= 2 && id[0] === 0x5f && id[1] === 0x5f) {
			return ApprovalStatus.SkipTree;
		}
		return ApprovalStatus.Ok;
	}

	/**
	 * Initialization is separated for the construction:
	 * a subclass should have a chance to init its stuff.
	 */
	public init(): void {
		// Bootstrap
		this._state = [new Uint8Array(0)];
		this._expandState(this._state[0], this._state);
	}

	/**
	 * Generates a new id by picking the best one fron the candidates.
	 * @param count How many times the generated id will be used
	 * count is need in order to work with an entropy properly
	 */
	public generate(count=1): Uint8Array {
		if (!this._state) {
			throw new Error('state should be inited');
		}

		// console.log('\t' + this._state.map(v => Buffer.from(v).toString()));
		let minInformationContent = Infinity;
		let bestCandidate: Uint8Array;

		// Premature optimization:
		// Use one Uint32Array for all iterations
		// We cound allocate a new array at each iteration
		// but why feeding the Garbage Collector?
		const occurences = new Uint32Array(256);

		// Pick the best candidate
		for (let candidate of this._state) {
			// Set occurences from the ambience
			occurences.set(this._ambienceStats);

			// Update it as if this candidate was picked
			for (let i = 0; i < candidate.length; i++) {
				// The message is extended with {count} times {candidate}
				occurences[candidate[i]] += count;
			}

			// The esimated information content
			let informationContent = getInformationContent(occurences);

			if (informationContent < minInformationContent) {
				minInformationContent = informationContent;
				bestCandidate = candidate;
			}
		}

		// The best candidate will be a part of the message
		// The next calls should count these bytes, too
		this.appendAmbience(bestCandidate, count);

		// Replace with other candidates
		this._expandState(bestCandidate, this._state);

		// TA-DA!
		return bestCandidate;
	}
}