// js/main.js

document.addEventListener('DOMContentLoaded', () => {
	const inputTextArea = document.getElementById('problemInput');
	const solveButton = document.getElementById('solveButton');
	const statusDiv = document.getElementById('solverStatus');
	const solutionOutput = document.getElementById('solutionOutput');
	const linkDistancesOutput = document.getElementById('linkDistancesOutput');

	const commandsOutput = document.getElementById('commandsOutput');
	const copyCommandsButton = document.getElementById('copyCommandsButton');
	const copyStatusSpan = document.getElementById('copyStatus');

	solveButton.addEventListener('click', async () => {
		const inputText = inputTextArea.value;
		solutionOutput.textContent = 'Parsing input...';
		linkDistancesOutput.textContent = ''; // Clear previous results
		commandsOutput.textContent = 'Commands will appear here...'; // Clear commands
		copyCommandsButton.disabled = true; // Disable copy button initially
		copyStatusSpan.textContent = ''; // Clear copy status

		solveButton.disabled = true;
		statusDiv.textContent = 'Status: Parsing...';

		try {
			const problem = parseProblem(inputText);
			// console.log("Parsed Problem:", problem);

			const statusCallback = (message) => {
				statusDiv.textContent = `Status: ${message}`;
			};

			const progressCallback = (iteration, maxIterations, temperature, cost) => {
				const progressPercent = ((iteration / maxIterations) * 100).toFixed(1);
				statusDiv.textContent = `Status: Optimizing... Iteration ${iteration}/${maxIterations} (${progressPercent}%) | Temp: ${temperature.toFixed(
					2
				)} | Best Cost: ${cost.toFixed(2)}`;
			};

			const solver = new PortalSolver(problem, statusCallback, progressCallback);
			const result = await solver.solve();

			// --- Format Output ---
			let outputText = `Solver Status: ${result.message}\n`;
			outputText += `Success: ${result.success}\n\n`;

			let generatedCommands = '';

			if (result.solution) {
				outputText += '--- Portal Positions ---\n';
				const sortedNames = Object.keys(result.solution).sort();
				for (const name of sortedNames) {
					const pos = result.solution[name];
					const portalInfo = problem.portals[name]; // Get portal info
					if (!portalInfo) {
						console.warn(`Portal info not found for ${name} during output generation.`);
						continue;
					}
					outputText += `${name} (${portalInfo.dim}, Face ${portalInfo.face}):\t(${pos.x}, ${pos.y}, ${pos.z})\n`;

					// --- Generate Command for this portal ---
					const dimension = portalInfo.dim === 'N' ? 'the_nether' : 'overworld';
					const axis = portalInfo.face === 'X' ? 'z' : 'x'; // Opposite of facing
					const command = `/execute in minecraft:${dimension} run setblock ${pos.x} ${pos.y} ${pos.z} minecraft:nether_portal[axis=${axis}] strict`;
					generatedCommands += command + '\n';
				}
				// Enable copy button only if commands were generated
				if (generatedCommands.length > 0) {
					commandsOutput.textContent = generatedCommands.trim(); // Put commands in pre, trim trailing newline
					copyCommandsButton.disabled = false;
				} else {
					commandsOutput.textContent = 'No commands generated (no solution found or no portals).';
				}
			} else {
				outputText += 'No solution found.\n';
				commandsOutput.textContent = 'No commands generated (no solution found).';
			}

			if (!result.success) {
				outputText += '\n--- Violated Constraints ---\n';
				if (result.violatedPositions.length > 0) {
					outputText += `Position Constraints Violated: ${result.violatedPositions.join(', ')}\n`;
				}
				if (result.violatedLinks.length > 0) {
					outputText += `Desired Links Violated: ${result.violatedLinks.join('; ')}\n`;
				}
			}

			if (Object.keys(result.optimizationDistances).length > 0) {
				outputText += '\n--- Optimization Goal Distances ---\n';
				for (const key in result.optimizationDistances) {
					const dist = result.optimizationDistances[key];
					outputText += `${key} (Weight: ${dist.weight}): ${dist.linear} (Sq: ${dist.squared})\n`;
				}
			}

			solutionOutput.textContent = outputText;

			// --- Format Link Distances Output ---
			let linkDistText =
				"Calculated distances (distSq & dist) from the Floored Scaled Position (Bd) of the source portal's center entity position to the destination portal's actual position (DestPos).\nLower distances generally mean more stable links.\n\n";
			const sortedLinkKeys = Object.keys(result.linkDistances).sort();
			for (const key of sortedLinkKeys) {
				const data = result.linkDistances[key];
				linkDistText += `${key}:\n`;
				linkDistText += `  Bd: ${data.Bd} -> DestPos: ${data.DestPos}\n`;
				linkDistText += `  Distance: ${data.dist} (Sq: ${data.distSq})\n\n`;
			}
			linkDistancesOutput.textContent = linkDistText;
		} catch (error) {
			statusDiv.textContent = 'Status: Error';
			solutionOutput.textContent = `Error: ${error.message}\n\n${error.stack || ''}`;
			linkDistancesOutput.textContent = '';
			commandsOutput.textContent = 'Error occurred, no commands generated.';
			copyCommandsButton.disabled = true;
			console.error('Solver Error:', error);
		} finally {
			solveButton.disabled = false;
			if (!statusDiv.textContent.startsWith('Status: Error')) {
				// Keep the final status message unless it was an error
				const finalStatus = statusDiv.textContent.replace('Optimizing...', 'Finished.');
				statusDiv.textContent = finalStatus;
			}
		}
	});

	copyCommandsButton.addEventListener('click', () => {
		const commandsToCopy = commandsOutput.textContent;
		if (!commandsToCopy || commandsToCopy.startsWith('No commands') || commandsToCopy.startsWith('Error')) {
			copyStatusSpan.textContent = 'Nothing to copy.';
			copyStatusSpan.style.color = 'red';
			return;
		}

		navigator.clipboard.writeText(commandsToCopy).then(
			() => {
				// Success feedback
				copyStatusSpan.textContent = 'Copied!';
				copyStatusSpan.style.color = 'green';
				// Optionally clear the message after a few seconds
				setTimeout(() => {
					copyStatusSpan.textContent = '';
				}, 2500);
			},
			(err) => {
				// Error feedback
				copyStatusSpan.textContent = 'Copy failed!';
				copyStatusSpan.style.color = 'red';
				console.error('Failed to copy commands: ', err);
			}
		);
	});
});
