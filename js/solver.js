// js/solver.js

class PortalSolver {
	constructor(problem, statusCallback, progressCallback) {
		this.problem = problem;
		this.statusCallback = statusCallback;
		this.progressCallback = progressCallback;

		this.portalNames = Object.keys(this.problem.portals);
		this.currentState = {}; // { portalName: {x, y, z}, ... }
		this.bestState = {};
		this.minCost = Infinity;

		// Tunable parameters for Simulated Annealing
		this.initialTemperature = 100000.0; // Adjust based on typical cost scales
		this.coolingRate = 0.995; // Geometric cooling factor
		this.absoluteTemperature = 0.01; // Stop when temperature is very low
		this.maxIterations = 100000; // Iteration limit
		this.iterationsPerUpdate = 5000; // How often to yield/update UI

		this.stage1MaxAttempts = 3;
		this.stage1CoolingRate = 0.997; // Slower cooling for stage 1 exploration
		this.stage1TempMultiplier = 1.5; // Higher starting temp for stage 1
		this.stage1LargeJumpChance = 0.2; // 20% chance of a large random jump in Stage 1
		this.stage1AcceptWorseViolationProb = 0.1; // Base probability to accept a move increasing violations
	}

	// --- Core Solver Logic (Simulated Annealing) ---

	// Ensure this method is part of the PortalSolver class

	async solve() {
		this.statusCallback('Initializing...');
		// Initialize State: Find a random starting point satisfying position constraints for all portals
		if (!this.initializeState()) {
			this.statusCallback('Initialization Failed: Could not find valid starting positions for all portals.');
			return { solution: null, success: false, message: 'Initialization failed (position constraints).' };
		}

		let feasibleState = null;
		let feasibleFound = false;
		// Track the best state found across all Stage 1 attempts, based on minimum violations
		let bestViolationState = this.copyState(this.currentState);
		let minViolationsFound = this.calculateCost(bestViolationState, 0); // Cost = violation count

		// --- Stage 1: Find Feasible Solution (with Retries & Large Jumps) ---
		for (let attempt = 1; attempt <= this.stage1MaxAttempts && !feasibleFound; attempt++) {
			this.statusCallback(`Stage 1 (Attempt ${attempt}/${this.stage1MaxAttempts}): Seeking Feasible Solution...`);

			// Re-initialize position for subsequent attempts if the first one fails, to get a fresh start
			if (attempt > 1) {
				if (!this.initializeState()) {
					this.statusCallback(`Initialization Failed on attempt ${attempt}. Skipping attempt.`);
					continue; // Skip this attempt if initialization fails
				}
				// Reset tracking for this new attempt's start
				bestViolationState = this.copyState(this.currentState);
				minViolationsFound = this.calculateCost(bestViolationState, 0);
			}

			// Configure Stage 1 parameters
			// Allocate a significant portion of iterations to finding feasibility
			let stage1Iterations = Math.floor(this.maxIterations * 0.7); // Example: 70% budget for feasibility
			let stage1Temp = this.initialTemperature * this.stage1TempMultiplier; // Higher starting temp
			let stage1CoolingRate = this.stage1CoolingRate; // Slower cooling

			// Start this attempt's search from the newly initialized state
			let stage1CurrentState = this.copyState(this.currentState);
			let stage1CurrentCost = this.calculateCost(stage1CurrentState, 0); // Cost = link violations

			// Update overall best violation count if this initial state is better than previous best
			if (stage1CurrentCost < minViolationsFound) {
				minViolationsFound = stage1CurrentCost;
				bestViolationState = this.copyState(stage1CurrentState);
			}

			// Check if the initial state for this attempt is already feasible
			if (stage1CurrentCost === 0) {
				this.statusCallback(`Stage 1 (Attempt ${attempt}): Initial state is feasible!`);
				feasibleFound = true;
				feasibleState = stage1CurrentState;
				break; // Exit attempt loop, proceed to Stage 2
			}

			// Run Simulated Annealing loop for Stage 1 feasibility search
			for (let i = 0; i < stage1Iterations; i++) {
				// Generate neighbor using Stage 1 logic (allows large jumps)
				const neighborState = this.generateNeighbor(stage1CurrentState, true);
				if (!neighborState) {
					// console.warn(`Stage 1 (Attempt ${attempt}, Iter ${i}): Failed to generate neighbor.`);
					continue; // Skip iteration if neighbor generation fails
				}

				const neighborCost = this.calculateCost(neighborState, 0); // Cost = link violations
				const deltaCost = neighborCost - stage1CurrentCost;

				// --- Stage 1 Acceptance Criteria ---
				let acceptMove = false;
				if (deltaCost < 0) {
					acceptMove = true; // Always accept improvements (fewer violations)
				} else if (deltaCost === 0) {
					// Accept sideways moves (same number of violations) based on standard SA probability
					// Helps explore plateaus of equal violation count. exp(0/T) = 1
					if (Math.random() < Math.exp(-deltaCost / stage1Temp)) {
						// Essentially accepts with prob 1 unless temp is 0
						acceptMove = true;
					}
				} else {
					// deltaCost > 0 (move increases violations)
					// Accept worsening moves with lower probability, dependent on temp & parameter
					// Allows escaping local minima of violations
					if (Math.random() < this.stage1AcceptWorseViolationProb * Math.exp(-deltaCost / stage1Temp)) {
						// console.log(`Stage 1: Accepted worse move (${stage1CurrentCost} -> ${neighborCost})`);
						acceptMove = true;
					}
				}

				if (acceptMove) {
					stage1CurrentState = neighborState;
					stage1CurrentCost = neighborCost;

					// Update the overall best violation state found across all attempts if this state is better
					if (stage1CurrentCost < minViolationsFound) {
						minViolationsFound = stage1CurrentCost;
						bestViolationState = this.copyState(stage1CurrentState);
					}

					// Check if we reached feasibility (0 violations)
					if (stage1CurrentCost === 0) {
						feasibleFound = true;
						feasibleState = stage1CurrentState;
						this.statusCallback(`Stage 1 (Attempt ${attempt}): Feasible solution found at iter ${i}.`);
						break; // Exit inner SA loop for this attempt
					}
				}

				// Cool down temperature for Stage 1
				stage1Temp *= stage1CoolingRate;

				// Update UI periodically
				if (i % this.iterationsPerUpdate === 0) {
					this.statusCallback(
						`Stage 1 (Attempt ${attempt}): Iter ${i}/${stage1Iterations}, Violations: ${stage1CurrentCost} (Best Overall: ${minViolationsFound}), Temp: ${stage1Temp.toFixed(
							2
						)}`
					);
					await new Promise((resolve) => setTimeout(resolve, 0)); // Yield to browser
				}

				// Stop if temperature is too low for effective search
				if (stage1Temp < this.absoluteTemperature) {
					// console.log(`Stage 1 (Attempt ${attempt}) cooled down at iter ${i}.`);
					break; // Exit inner SA loop if cooled down
				}
			} // End inner SA loop for Stage 1 attempt

			// If feasible solution found in this attempt, break the outer attempt loop
			if (feasibleFound) {
				break;
			}
			// Log if attempt finished without finding solution before starting next attempt
			if (attempt < this.stage1MaxAttempts) {
				const currentAttemptMinViolations = this.calculateCost(stage1CurrentState, 0); // Check final state of this attempt
				if (currentAttemptMinViolations < minViolationsFound) {
					// Update overall best if needed
					minViolationsFound = currentAttemptMinViolations;
					bestViolationState = this.copyState(stage1CurrentState);
				}
				this.statusCallback(
					`Stage 1 (Attempt ${attempt}) finished. Min violations this attempt: ${currentAttemptMinViolations}. Proceeding to next attempt.`
				);
				await new Promise((resolve) => setTimeout(resolve, 5)); // Small pause before next attempt starts
			}
		} // End Stage 1 attempt loop

		// --- Handle Stage 1 Outcome ---
		if (!feasibleFound) {
			// Feasibility search failed across all attempts
			this.statusCallback(
				`Stage 1 Failed after ${this.stage1MaxAttempts} attempts: Could not find feasible solution. Min violations found: ${minViolationsFound}.`
			);
			// Return the best state found (minimum violations), even though it's invalid
			const result = this.verifySolution(bestViolationState); // Verify the best-effort state
			result.message = `Stage 1 Failed: Could not find state satisfying all link constraints (min violations = ${minViolationsFound}). Best attempt shown.`;
			result.success = false; // Mark as failure
			// Update portal objects with the best-attempt positions for output
			for (const name in bestViolationState) {
				if (this.problem.portals[name]) {
					// Ensure portal exists before assigning
					this.problem.portals[name].pos = bestViolationState[name];
				} else {
					console.warn(`Portal ${name} not found in problem definition during Stage 1 failure output.`);
				}
			}
			return result;
		}

		// --- Stage 2: Optimize from Feasible Solution (Strictly Feasible) ---
		this.statusCallback('Stage 1 Complete: Feasible solution found. Starting Stage 2 Optimization.');

		// Start Stage 2 from the feasible state found
		this.currentState = this.copyState(feasibleState);
		// Calculate the initial full cost (including optimization terms) of the feasible state
		let currentFullCost = this.calculateCost(this.currentState, 1.0);
		this.minCost = currentFullCost; // This is the best cost found so far (must be feasible)
		this.bestState = this.copyState(this.currentState); // This is the best feasible state found so far

		// Configure Stage 2 parameters
		// Allocate remaining iterations (or a minimum fraction) to optimization
		let stage2Iterations = this.maxIterations - Math.floor(this.maxIterations * 0.7); // Use remaining budget
		if (stage2Iterations <= this.iterationsPerUpdate) stage2Iterations = Math.floor(this.maxIterations * 0.3); // Ensure some budget if stage 1 took almost all
		let temperature = this.initialTemperature; // Reset temperature for optimization phase
		let stage2CoolingRate = this.coolingRate; // Use standard cooling rate

		// Run Simulated Annealing loop for Stage 2 optimization
		for (let iter = 0; iter < stage2Iterations; iter++) {
			// Generate neighbor using Stage 2 logic (small moves only, no large jumps)
			const neighborState = this.generateNeighbor(this.currentState, false);
			if (!neighborState) {
				// console.warn(`Stage 2 (Iter ${iter}): Failed to generate neighbor.`);
				continue; // Skip iteration if neighbor generation fails
			}

			// --- Stage 2 Strict Feasibility Check ---
			// Check if the neighbor state violates any link constraints. Calculate cost with weight 0.
			const neighborViolations = this.calculateCost(neighborState, 0);
			if (neighborViolations > 0) {
				// If the neighbor state is NOT feasible, reject it immediately.
				// Do not even calculate its full cost or consider SA acceptance.
				continue;
			}

			// --- Neighbor is Feasible: Apply SA ---
			// Calculate the full cost (including optimization penalty & objectives) of the feasible neighbor
			const neighborFullCost = this.calculateCost(neighborState, 1.0);
			const deltaCost = neighborFullCost - currentFullCost;

			// Apply standard SA acceptance criteria ONLY to feasible neighbors
			if (deltaCost < 0 || Math.random() < Math.exp(-deltaCost / temperature)) {
				// Accept the feasible neighbor (it's either better or accepted by probability)
				this.currentState = neighborState;
				currentFullCost = neighborFullCost;

				// Update the overall best state if this accepted state has a lower full cost
				// (We know it's feasible because it passed the check above)
				if (currentFullCost < this.minCost) {
					this.minCost = currentFullCost;
					this.bestState = this.copyState(this.currentState);
				}
			}

			// Cool down temperature for Stage 2
			temperature *= stage2CoolingRate;

			// Update UI periodically
			if (iter % this.iterationsPerUpdate === 0) {
				// Report the cost of the *best* feasible state found so far
				this.progressCallback(iter, stage2Iterations, temperature, this.minCost);
				await new Promise((resolve) => setTimeout(resolve, 0)); // Yield to browser
			}

			// Stop if temperature is too low for effective optimization
			if (temperature < this.absoluteTemperature) {
				// console.log(`Stage 2 cooled down at iter ${iter}.`);
				break; // Exit Stage 2 loop
			}
		} // End Stage 2 SA loop

		// --- Finalize and Return ---
		this.statusCallback('Optimization finished. Verifying best solution...');

		// Verify the best feasible state found during Stage 2
		const finalResult = this.verifySolution(this.bestState);

		// Final sanity check: Ensure the best state IS actually feasible.
		// This should always be true due to the strict check in Stage 2, but double-check.
		const finalViolations = this.calculateCost(this.bestState, 0);
		if (finalViolations > 0) {
			console.error(
				`INTERNAL ERROR: Stage 2 finished but bestState has ${finalViolations} violations! This should not happen.`
			);
			finalResult.success = false; // Mark as failed despite previous success
			finalResult.message =
				(finalResult.message || 'Optimization finished.') +
				` (Internal Error: Final state has ${finalViolations} violations)`;
		} else if (finalResult.success) {
			finalResult.message = 'Solution found and optimized.'; // More positive message on success
		}

		// Update portal objects in the original problem definition with the final positions for output
		for (const name in this.bestState) {
			if (this.problem.portals[name]) {
				// Ensure portal exists before assigning
				this.problem.portals[name].pos = this.bestState[name];
			} else {
				console.warn(`Portal ${name} not found in problem definition during final output update.`);
			}
		}

		return finalResult;
	}

	// --- State Management & Initialization ---

	copyState(state) {
		const newState = {};
		for (const name in state) {
			newState[name] = copyVec3(state[name]);
		}
		return newState;
	}

	initializeState() {
		const initialState = {};
		for (const name of this.portalNames) {
			const portal = this.problem.portals[name];
			let foundPos = false;
			// Try up to 100 random positions within the first inclusive constraint
			for (let attempt = 0; attempt < 100; attempt++) {
				const incConstraint =
					portal.constraints.inclusive[randomInt(0, portal.constraints.inclusive.length - 1)];
				const pos = vec3(
					randomInt(incConstraint.min.x, incConstraint.max.x),
					randomInt(incConstraint.min.y, incConstraint.max.y),
					randomInt(incConstraint.min.z, incConstraint.max.z)
				);
				if (this.satisfiesPositionConstraints(portal, pos)) {
					initialState[name] = pos;
					foundPos = true;
					break;
				}
			}
			if (!foundPos) {
				console.error(`Could not find initial valid position for portal ${name}`);
				return false; // Cannot initialize
			}
		}
		this.currentState = initialState;
		return true;
	}

	// --- Neighbor Generation ---

	generateNeighbor(state, isStage1 = false) {
		const newState = this.copyState(state);
		const portalName = this.portalNames[randomInt(0, this.portalNames.length - 1)];
		const portal = this.problem.portals[portalName];
		const currentPos = newState[portalName];

		// --- Stage 1: Potential Large Jump ---
		if (isStage1 && Math.random() < this.stage1LargeJumpChance) {
			// Try to find a new random valid position
			for (let jumpAttempt = 0; jumpAttempt < 10; jumpAttempt++) {
				// Try a few times
				// Pick a random inclusive constraint for this portal
				if (portal.constraints.inclusive.length === 0) break; // Should not happen based on parser validation
				const incConstraint =
					portal.constraints.inclusive[randomInt(0, portal.constraints.inclusive.length - 1)];
				const randomPos = vec3(
					randomInt(incConstraint.min.x, incConstraint.max.x),
					randomInt(incConstraint.min.y, incConstraint.max.y),
					randomInt(incConstraint.min.z, incConstraint.max.z)
				);

				// Check if this random position is valid (not in any exclusive box)
				let isInExclusive = false;
				for (const exc of portal.constraints.exclusive) {
					if (
						randomPos.x >= exc.min.x &&
						randomPos.x <= exc.max.x &&
						randomPos.y >= exc.min.y &&
						randomPos.y <= exc.max.y &&
						randomPos.z >= exc.min.z &&
						randomPos.z <= exc.max.z
					) {
						isInExclusive = true;
						break;
					}
				}

				if (!isInExclusive) {
					// console.log(`Stage 1 Large Jump: ${portalName} to (${randomPos.x}, ${randomPos.y}, ${randomPos.z})`);
					newState[portalName] = randomPos;
					return newState; // Return the state with the large jump
				}
			}
			// If large jump failed to find valid spot after attempts, fall through to small move
		}

		// --- Default: Small Random Move ---
		const moveRange = 3;
		for (let attempt = 0; attempt < 50; ++attempt) {
			const move = vec3(
				randomInt(-moveRange, moveRange),
				randomInt(-moveRange, moveRange),
				randomInt(-moveRange, moveRange)
			);
			if (move.x === 0 && move.y === 0 && move.z === 0) continue;

			const nextPos = addVec3(currentPos, move);

			// Check position constraints (inclusive and exclusive)
			let isInInclusive = false;
			for (const inc of portal.constraints.inclusive) {
				if (
					nextPos.x >= inc.min.x &&
					nextPos.x <= inc.max.x &&
					nextPos.y >= inc.min.y &&
					nextPos.y <= inc.max.y &&
					nextPos.z >= inc.min.z &&
					nextPos.z <= inc.max.z
				) {
					isInInclusive = true;
					break;
				}
			}
			if (!isInInclusive) continue;

			let isInExclusive = false;
			for (const exc of portal.constraints.exclusive) {
				if (
					nextPos.x >= exc.min.x &&
					nextPos.x <= exc.max.x &&
					nextPos.y >= exc.min.y &&
					nextPos.y <= exc.max.y &&
					nextPos.z >= exc.min.z &&
					nextPos.z <= exc.max.z
				) {
					isInExclusive = true;
					break;
				}
			}
			if (isInExclusive) continue;

			// Valid small move found
			newState[portalName] = nextPos;
			return newState;
		}

		return null; // Failed to generate any valid neighbor
	}

	// --- Constraint Checking & Cost Calculation ---

	satisfiesPositionConstraints(portal, pos) {
		let isInInclusive = false;
		for (const inc of portal.constraints.inclusive) {
			if (
				pos.x >= inc.min.x &&
				pos.x <= inc.max.x &&
				pos.y >= inc.min.y &&
				pos.y <= inc.max.y &&
				pos.z >= inc.min.z &&
				pos.z <= inc.max.z
			) {
				isInInclusive = true;
				break;
			}
		}
		if (!isInInclusive) return false;

		for (const exc of portal.constraints.exclusive) {
			if (
				pos.x >= exc.min.x &&
				pos.x <= exc.max.x &&
				pos.y >= exc.min.y &&
				pos.y <= exc.max.y &&
				pos.z >= exc.min.z &&
				pos.z <= exc.max.z
			) {
				return false; // Violates exclusion
			}
		}
		return true; // Satisfies all position constraints
	}

	// The complex linking check
	checkActualLink(sourcePortalName, expectedDestPortalName, currentState) {
		const sourcePortal = this.problem.portals[sourcePortalName];
		const sourcePos = currentState[sourcePortalName];
		const destDim = this.problem.portals[expectedDestPortalName].dim;

		const testPositions = getEntityTestPositions(sourcePos, sourcePortal.face, this.problem.entitySize);
		const coordScale = getCoordScale(destDim);
		const searchRadius = getSearchRadius(destDim);

		for (const entityPos of testPositions) {
			// 1. & 2. Scale position
			const Pd = scaleVec3XZ(entityPos, coordScale);
			// 4. Floor
			const Bd = floorVec3(Pd);

			// 6. Get portals in destination dimension within search area
			let potentialTargets = [];
			for (const name in currentState) {
				const potentialPortal = this.problem.portals[name];
				if (potentialPortal.dim !== destDim) continue;

				const C = currentState[name]; // Potential target position

				// Check if within square search area
				if (Math.abs(C.x - Bd.x) <= searchRadius && Math.abs(C.z - Bd.z) <= searchRadius) {
					potentialTargets.push({ name: name, pos: C });
				}
			}

			if (potentialTargets.length === 0) {
				// console.warn(`Link check failed for ${sourcePortalName}: No portals found in search radius for test pos ${JSON.stringify(entityPos)} -> Bd ${JSON.stringify(Bd)}`);
				return false; // No portal found for this entity position
			}

			// 7. Find closest portal
			let closestPortalName = null;
			let minDistanceSq = Infinity;
			let minY = Infinity;

			for (const target of potentialTargets) {
				const distSqVal = distSq(Bd, target.pos);

				if (distSqVal < minDistanceSq) {
					minDistanceSq = distSqVal;
					minY = target.pos.y;
					closestPortalName = target.name;
				} else if (distSqVal === minDistanceSq) {
					// 8. Tie-breaker: lower Y
					if (target.pos.y < minY) {
						minY = target.pos.y;
						closestPortalName = target.name;
					}
				}
			}

			// 9. Check if the closest is the expected one
			if (closestPortalName !== expectedDestPortalName) {
				// console.warn(`Link check failed: ${sourcePortalName} -> ${closestPortalName} (expected ${expectedDestPortalName}) for entity pos ${JSON.stringify(entityPos)}`);
				return false; // This entity position links incorrectly
			}
		}

		return true; // All test positions linked correctly
	}

	calculateCost(state, optimizationWeightMultiplier = 1.0) {
		let cost = 0;
		let linkViolations = 0;
		let posViolations = 0; // Should be 0

		// --- Penalize Link Violations (High Penalty in Stage 2, Basic Count in Stage 1) ---
		// Use a VERY large penalty in stage 2. Use 1.0 in stage 1.
		const linkPenaltyFactor = optimizationWeightMultiplier > 0 ? 10000000000 : 1.0; // Even larger penalty for stage 2

		for (const link of this.problem.desiredLinks) {
			if (!this.checkActualLink(link.source, link.dest, state)) {
				linkViolations++;
			}
		}
		cost += linkViolations * linkPenaltyFactor;

		// --- Penalize Position Violations (Should ideally be zero) ---
		const posPenalty = 10000000; // Keep high just in case
		for (const name in state) {
			if (!this.satisfiesPositionConstraints(this.problem.portals[name], state[name])) {
				posViolations++;
			}
		}
		cost += posViolations * posPenalty;

		// --- Add Optimization Distances (Only if weight > 0) ---
		if (optimizationWeightMultiplier > 0) {
			let totalWeightedOptimizationDistanceSq = 0;
			const currentPortalData = {};
			for (const name in this.problem.portals) {
				currentPortalData[name] = { ...this.problem.portals[name], pos: state[name] };
			}
			for (const pair of this.problem.optimizationPairs) {
				let distSq = 0;
				if (pair.type === 'portal') {
					distSq += calculateOptimizationDistanceSq({ name: pair.p1 }, { name: pair.p2 }, currentPortalData);
				} else if (pair.type === 'position') {
					distSq += calculateOptimizationDistancePosSq({ name: pair.p1 }, pair.p2, currentPortalData);
				}

				// Apply the individual weight for this pair
				// Also multiply by the overall optimizationWeightMultiplier (usually 1.0 in Stage 2)
				totalWeightedOptimizationDistanceSq += distSq * pair.weight * optimizationWeightMultiplier;
			}
			cost += totalWeightedOptimizationDistanceSq;
		}

		// Store violation counts for checking
		this.lastLinkViolations = linkViolations;
		this.lastPosViolations = posViolations;

		return cost;
	}

	// --- Verification and Output Formatting ---

	verifySolution(state) {
		const results = {
			solution: state,
			success: true,
			message: 'Solution found.',
			violatedLinks: [],
			violatedPositions: [],
			optimizationDistances: {},
			linkDistances: {}, // Store actual calculated link distances
		};

		// Check position constraints
		for (const name in state) {
			if (!this.satisfiesPositionConstraints(this.problem.portals[name], state[name])) {
				results.success = false;
				results.violatedPositions.push(name);
			}
		}

		// Check link constraints
		for (const link of this.problem.desiredLinks) {
			if (!this.checkActualLink(link.source, link.dest, state)) {
				results.success = false;
				results.violatedLinks.push(`${link.source} -> ${link.dest}`);
			}
		}

		if (!results.success) {
			results.message = 'Constraints violated. Best attempt shown.';
			if (results.violatedPositions.length > 0) {
				results.message += ` Portals violating position constraints: ${results.violatedPositions.join(', ')}.`;
			}
			if (results.violatedLinks.length > 0) {
				results.message += ` Desired links not satisfied: ${results.violatedLinks.join('; ')}.`;
			}
		}

		// Calculate final optimization distances
		const finalPortalData = {};
		for (const name in this.problem.portals) {
			finalPortalData[name] = { ...this.problem.portals[name], pos: state[name] };
		}
		for (const pair of this.problem.optimizationPairs) {
			let distSq;
			let key;
			if (pair.type === 'portal') {
				key = `${pair.p1} <-> ${pair.p2}`;
				distSq = calculateOptimizationDistanceSq({ name: pair.p1 }, { name: pair.p2 }, finalPortalData);
			} else {
				// position
				key = `${pair.p1} <-> [${pair.p2.x},${pair.p2.y},${pair.p2.z}]`;
				distSq = calculateOptimizationDistancePosSq({ name: pair.p1 }, pair.p2, finalPortalData);
			}
			results.optimizationDistances[key] = {
				squared: distSq.toFixed(2),
				linear: Math.sqrt(distSq).toFixed(2),
				weight: pair.weight.toFixed(1),
			};
		}

		// Calculate inter-dimensional link search distances (using center point)
		results.linkDistances = this.calculateAllLinkDistances(state);

		return results;
	}

	// Calculate the distance used by the linking algorithm (from Bd to C) for all O<->N pairs
	calculateAllLinkDistances(state) {
		const linkDistances = {};
		const portalNames = Object.keys(state);

		for (let i = 0; i < portalNames.length; i++) {
			const p1Name = portalNames[i];
			const portal1 = this.problem.portals[p1Name];
			const pos1 = state[p1Name];

			for (let j = 0; j < portalNames.length; j++) {
				if (i === j) continue; // Skip self
				const p2Name = portalNames[j];
				const portal2 = this.problem.portals[p2Name];
				const pos2 = state[p2Name];

				// Only consider pairs in different dimensions
				if (portal1.dim === portal2.dim) continue;

				// Calculate from p1 perspective
				const sourcePortal = portal1;
				const sourcePos = pos1;
				const destPortal = portal2;
				const destPos = pos2;
				const destDim = destPortal.dim;

				// Use only the center entity position for this calculation
				const entityPosCenter = addVec3(sourcePos, Constants.ENTITY_DECIMAL_OFFSET);
				const coordScale = getCoordScale(destDim);
				const Pd = scaleVec3XZ(entityPosCenter, coordScale);
				const Bd = floorVec3(Pd);

				// Calculate distance squared from Bd to the actual destination portal C
				const distSqVal = distSq(Bd, destPos);

				const key = `${p1Name} (${portal1.dim}) -> ${p2Name} (${portal2.dim})`;
				linkDistances[key] = {
					Bd: `(${Bd.x}, ${Bd.y}, ${Bd.z})`,
					DestPos: `(${destPos.x}, ${destPos.y}, ${destPos.z})`,
					distSq: distSqVal.toFixed(0),
					dist: Math.sqrt(distSqVal).toFixed(1),
				};
			}
		}
		return linkDistances;
	}
}
