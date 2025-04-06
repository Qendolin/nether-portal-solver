// js/utils.js

const Constants = {
	O_DIM: 'O',
	N_DIM: 'N',
	O_SCALE: 1 / 8,
	N_SCALE: 8,
	O_SEARCH_RADIUS: 128,
	N_SEARCH_RADIUS: 16,
	ENTITY_DECIMAL_OFFSET: { x: 0.5, y: 0.0, z: 0.5 }, // Portal center offset
};

function vec3(x = 0, y = 0, z = 0) {
	return { x, y, z };
}

function copyVec3(v) {
	return { x: v.x, y: v.y, z: v.z };
}

function addVec3(v1, v2) {
	return { x: v1.x + v2.x, y: v1.y + v2.y, z: v1.z + v2.z };
}

function floorVec3(v) {
	return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

function scaleVec3XZ(v, scale) {
	return { x: v.x * scale, y: v.y, z: v.z * scale };
}

function distSq(p1, p2) {
	const dx = p1.x - p2.x;
	const dy = p1.y - p2.y;
	const dz = p1.z - p2.z;
	return dx * dx + dy * dy + dz * dz;
}

function getCoordScale(destinationDimension) {
	// If destination is Nether, the travel was O -> N, use O_SCALE (1/8)
	// If destination is Overworld, the travel was N -> O, use N_SCALE (8)
	return destinationDimension === Constants.N_DIM ? Constants.O_SCALE : Constants.N_SCALE;
}

function getSearchRadius(dimension) {
	return dimension === Constants.N_DIM ? Constants.N_SEARCH_RADIUS : Constants.O_SEARCH_RADIUS;
}

// Convert N-coords to O-coords for optimization distance calc
function convertToOverworld(pos, sourceDimension) {
	if (sourceDimension === Constants.O_DIM) {
		return copyVec3(pos); // Already in Overworld
	} else {
		// sourceDimension === Constants.N_DIM
		// Convert N -> O using the N_SCALE (8)
		return scaleVec3XZ(pos, Constants.N_SCALE);
	}
}

// Calculate distance for optimization objective
function calculateOptimizationDistanceSq(portal1, portal2, portalData) {
	const pos1 = portalData[portal1.name].pos;
	const dim1 = portalData[portal1.name].dim;
	const pos2 = portalData[portal2.name].pos;
	const dim2 = portalData[portal2.name].dim;

	// Always convert N to O for comparison
	const pos1_O = convertToOverworld(pos1, dim1);
	const pos2_O = convertToOverworld(pos2, dim2);

	return distSq(pos1_O, pos2_O);
}

function calculateOptimizationDistancePosSq(portal1, targetPosO, portalData) {
	const pos1 = portalData[portal1.name].pos;
	const dim1 = portalData[portal1.name].dim;

	const pos1_O = convertToOverworld(pos1, dim1);

	return distSq(pos1_O, targetPosO);
}

// Get entity test positions based on portal center, facing, and width
function getEntityTestPositions(portalPosInt, facing, entityWidth) {
	const center = addVec3(portalPosInt, Constants.ENTITY_DECIMAL_OFFSET);
	const halfWidth = entityWidth / 2.0;
	const testPositions = [center]; // Always test the center

	if (facing === 'X') {
		// Entity spread is along Z
		testPositions.push({ x: center.x, y: center.y, z: center.z + halfWidth });
		testPositions.push({ x: center.x, y: center.y, z: center.z - halfWidth });
	} else {
		// facing === 'Z'
		// Entity spread is along X
		testPositions.push({ x: center.x + halfWidth, y: center.y, z: center.z });
		testPositions.push({ x: center.x - halfWidth, y: center.y, z: center.z });
	}
	return testPositions;
}

// Clamp value within range
function clamp(value, min, max) {
	return Math.max(min, Math.min(value, max));
}

// Get random integer between min (inclusive) and max (inclusive)
function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
