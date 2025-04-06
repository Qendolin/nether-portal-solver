// js/parser.js

function parseProblem(inputText) {
	const lines = inputText.split('\n');
	const problem = {
		entitySize: 1.0, // Default
		portals: {},
		positionConstraints: [],
		desiredLinks: [],
		optimizationPairs: [],
	};

	const portalNames = new Set();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.startsWith('#') || line === '') continue;

		const parts = line.split(/\s+/);
		const command = parts[0].toUpperCase();

		try {
			switch (command) {
				case 'ENTITY_SIZE':
					if (parts.length !== 2 || isNaN(parseFloat(parts[1]))) {
						throw new Error(`Invalid ENTITY_SIZE format`);
					}
					problem.entitySize = parseFloat(parts[1]);
					if (problem.entitySize <= 0) {
						throw new Error(`ENTITY_SIZE must be positive`);
					}
					break;

				case 'PORTAL':
					if (parts.length !== 4) throw new Error(`Invalid PORTAL format`);
					const [_, name, dim, face] = parts;
					if (portalNames.has(name)) throw new Error(`Duplicate portal name: ${name}`);
					if (dim !== Constants.O_DIM && dim !== Constants.N_DIM)
						throw new Error(`Invalid dimension '${dim}' for portal ${name}`);
					if (face !== 'X' && face !== 'Z') throw new Error(`Invalid facing '${face}' for portal ${name}`);
					problem.portals[name] = {
						name: name,
						dim: dim,
						face: face,
						pos: vec3(), // Position to be solved
						constraints: { inclusive: [], exclusive: [] },
						desiredLinks: [], // Store desired links originating from here
					};
					portalNames.add(name);
					break;

				case 'POS':
					if (parts.length !== 9) throw new Error(`Invalid POS format`);
					const portalNamePos = parts[1];
					const type = parts[2].toUpperCase();
					const coords = parts.slice(3).map(Number);
					if (!portalNames.has(portalNamePos))
						throw new Error(`Unknown portal '${portalNamePos}' in POS constraint`);
					if (type !== 'INC' && type !== 'EXC') throw new Error(`Invalid POS type '${type}'`);
					if (coords.some(isNaN))
						throw new Error(`Invalid coordinates in POS constraint for ${portalNamePos}`);
					const min = vec3(coords[0], coords[1], coords[2]);
					const max = vec3(coords[3], coords[4], coords[5]);
					if (min.x > max.x || min.y > max.y || min.z > max.z) {
						throw new Error(
							`Min coordinates must be <= Max coordinates in POS constraint for ${portalNamePos}`
						);
					}
					const constraint = { portalName: portalNamePos, type: type, min: min, max: max };
					problem.positionConstraints.push(constraint);
					// Also add to portal object for easier access
					if (type === 'INC') {
						problem.portals[portalNamePos].constraints.inclusive.push(constraint);
					} else {
						problem.portals[portalNamePos].constraints.exclusive.push(constraint);
					}
					break;

				case 'LINK':
					if (parts.length !== 3) throw new Error(`Invalid LINK format`);
					const source = parts[1];
					const dest = parts[2];
					if (!portalNames.has(source)) throw new Error(`Unknown source portal '${source}' in LINK`);
					if (!portalNames.has(dest)) throw new Error(`Unknown destination portal '${dest}' in LINK`);
					if (problem.portals[source].dim === problem.portals[dest].dim) {
						throw new Error(
							`LINK source '${source}' (${problem.portals[source].dim}) and destination '${dest}' (${problem.portals[dest].dim}) must be in different dimensions`
						);
					}
					const link = { source: source, dest: dest };
					problem.desiredLinks.push(link);
					problem.portals[source].desiredLinks.push(dest); // Store outgoing link target name
					break;

				case 'OPTIMIZE':
					if (parts.length !== 3 && parts.length !== 4) throw new Error(`Invalid OPTIMIZE format`);
					const p1 = parts[1];
					const p2 = parts[2];
					let weightOpt = 1.0;

					if (!portalNames.has(p1)) throw new Error(`Unknown portal '${p1}' in OPTIMIZE`);
					if (!portalNames.has(p2)) throw new Error(`Unknown portal '${p2}' in OPTIMIZE`);

					if (parts.length === 4) {
						weightOpt = parseFloat(parts[3]);
						if (isNaN(weightOpt) || weightOpt < 0) {
							throw new Error(`Invalid or negative weight '${parts[3]}' for OPTIMIZE ${p1} ${p2}`);
						}
					}
					problem.optimizationPairs.push({ type: 'portal', p1: p1, p2: p2, weight: weightOpt });
					break;

				case 'OPTIMIZE_POS':
					if (parts.length !== 5 && parts.length !== 6) throw new Error(`Invalid OPTIMIZE_POS format`);
					const portalNameOpt = parts[1];
					const targetCoords = parts.slice(2).map(Number);
					let weightPos = 1.0;

					if (!portalNames.has(portalNameOpt))
						throw new Error(`Unknown portal '${portalNameOpt}' in OPTIMIZE_POS`);
					if (targetCoords.some(isNaN))
						throw new Error(`Invalid coordinates in OPTIMIZE_POS for ${portalNameOpt}`);

					if (parts.length === 6) {
						weightPos = parseFloat(parts[5]);
						if (isNaN(weightPos) || weightPos < 0) {
							throw new Error(
								`Invalid or negative weight '${parts[5]}' for OPTIMIZE_POS ${portalNameOpt}`
							);
						}
					}

					problem.optimizationPairs.push({
						type: 'position',
						p1: portalNameOpt,
						p2: vec3(targetCoords[0], targetCoords[1], targetCoords[2]),
						weight: weightPos,
					});
					break;

				default:
					throw new Error(`Unknown command: ${command}`);
			}
		} catch (error) {
			throw new Error(`Error parsing line ${i + 1}: ${line}\n${error.message}`);
		}
	}

	// Final validation
	for (const name in problem.portals) {
		if (problem.portals[name].constraints.inclusive.length === 0) {
			throw new Error(`Portal ${name} has no inclusive position constraints (POS INC) defined.`);
		}
	}
	if (Object.keys(problem.portals).length < 2) {
		console.warn('Warning: Less than two portals defined. Linking and optimization might be trivial.');
	}

	return problem;
}
