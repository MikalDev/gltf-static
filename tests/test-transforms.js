// tests/test-transforms.js
// Integration tests that validate the ACTUAL worker implementation
// Run: node tests/test-transforms.js

const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// Read the actual TransformWorkerPool.ts to extract the real worker code
const poolSourcePath = path.join(__dirname, '../c3runtime/gltf/TransformWorkerPool.ts');
const poolSource = fs.readFileSync(poolSourcePath, 'utf8');

// Extract the WORKER_CODE string from the source
const workerCodeMatch = poolSource.match(/const WORKER_CODE = `([\s\S]*?)`;/);
if (!workerCodeMatch) {
  console.error('Failed to extract WORKER_CODE from TransformWorkerPool.ts');
  process.exit(1);
}

// Get the actual worker code that will run in production
const ACTUAL_WORKER_CODE = workerCodeMatch[1];

// Wrap for Node.js worker_threads (production uses browser Web Workers)
const NODE_WORKER_CODE = `
const { parentPort } = require('worker_threads');

// Replace browser's self.onmessage/postMessage with Node's parentPort
const self = {
  postMessage: (msg, transfer) => parentPort.postMessage(msg)
};

${ACTUAL_WORKER_CODE.replace('self.onmessage = (e) =>', 'parentPort.on("message", (data) => { const e = { data }; ')}
});
`;

// Reference implementation using gl-matrix math (known correct)
function referenceTransform(positions, matrix) {
  const result = new Float32Array(positions.length);
  const vertexCount = positions.length / 3;

  // Standard 4x4 matrix transform (same as gl-matrix vec3.transformMat4)
  const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2];
  const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
  const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10];
  const m12 = matrix[12], m13 = matrix[13], m14 = matrix[14];

  for (let i = 0; i < vertexCount; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    // This is the standard mat4 * vec3 formula (w=1 assumed)
    result[idx] = m0 * x + m4 * y + m8 * z + m12;
    result[idx + 1] = m1 * x + m5 * y + m9 * z + m13;
    result[idx + 2] = m2 * x + m6 * y + m10 * z + m14;
  }

  return result;
}

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function arraysAlmostEqual(a, b, epsilon = 0.0001) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) return false;
  }
  return true;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertArraysEqual(actual, expected, message) {
  if (!arraysAlmostEqual(actual, expected)) {
    const actualStr = Array.from(actual).map(n => n.toFixed(4)).join(', ');
    const expectedStr = Array.from(expected).map(n => n.toFixed(4)).join(', ');
    throw new Error(`${message || 'Arrays not equal'}\n      Expected: [${expectedStr}]\n      Actual:   [${actualStr}]`);
  }
}

// Create a worker instance for testing
function createTestWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(NODE_WORKER_CODE, { eval: true });
    worker.on('error', reject);
    worker.on('online', () => resolve(worker));
  });
}

// Send message to worker and wait for response
function workerRequest(worker, message) {
  return new Promise((resolve) => {
    worker.once('message', resolve);
    worker.postMessage(message);
  });
}

// Standard test matrices
const IDENTITY = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);

const SCALE_2X = new Float32Array([
  2, 0, 0, 0,
  0, 2, 0, 0,
  0, 0, 2, 0,
  0, 0, 0, 1
]);

const TRANSLATE_10_20_30 = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  10, 20, 30, 1
]);

// Rotation matrix around Y axis by 90 degrees (column-major)
// Standard Y rotation: [cos, 0, -sin, 0,  0, 1, 0, 0,  sin, 0, cos, 0,  0, 0, 0, 1]
// For 90°: cos(90)=0, sin(90)=1 → [0, 0, -1, 0,  0, 1, 0, 0,  1, 0, 0, 0,  0, 0, 0, 1]
// This rotates (1,0,0) to (0,0,-1)
const ROTATE_Y_90 = new Float32Array([
  0, 0, -1, 0,
  0, 1, 0, 0,
  1, 0, 0, 0,
  0, 0, 0, 1
]);

// Combined transform: scale 2x, translate (5, 10, 15)
const SCALE_AND_TRANSLATE = new Float32Array([
  2, 0, 0, 0,
  0, 2, 0, 0,
  0, 0, 2, 0,
  5, 10, 15, 1
]);

async function runTests() {
  console.log('\n=== Worker Transform Integration Tests ===\n');
  console.log('Testing ACTUAL worker code extracted from TransformWorkerPool.ts\n');

  let worker;

  try {
    worker = await createTestWorker();
  } catch (e) {
    console.error('Failed to create worker:', e.message);
    process.exit(1);
  }

  // Test 1: Identity matrix preserves positions
  await test('identity matrix preserves positions (worker)', async () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    worker.postMessage({ type: 'REGISTER', meshId: 1, positions: new Float32Array(positions) });
    await new Promise(r => setTimeout(r, 10)); // Let registration complete

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [{ meshId: 1, matrix: IDENTITY }]
    });

    assert(result.type === 'TRANSFORM_RESULTS', 'Expected TRANSFORM_RESULTS');
    assert(result.meshIds[0] === 1, 'Expected meshId 1');

    const start = result.offsets[0];
    const end = result.offsets[1];
    const transformed = result.positions.subarray(start, end);

    assertArraysEqual(transformed, positions, 'Identity should preserve positions');
  });

  // Test 2: Scale transform
  await test('scale 2x doubles all coordinates (worker)', async () => {
    const positions = new Float32Array([1, 2, 3]);
    const expected = referenceTransform(positions, SCALE_2X);

    worker.postMessage({ type: 'REGISTER', meshId: 2, positions: new Float32Array(positions) });
    await new Promise(r => setTimeout(r, 10));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [{ meshId: 2, matrix: SCALE_2X }]
    });

    const transformed = result.positions.subarray(result.offsets[0], result.offsets[1]);
    assertArraysEqual(transformed, expected, 'Scale 2x should double coordinates');
    assertArraysEqual(transformed, [2, 4, 6], 'Expected [2, 4, 6]');
  });

  // Test 3: Translation transform
  await test('translation offsets positions correctly (worker)', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 1, 1]);
    const expected = referenceTransform(positions, TRANSLATE_10_20_30);

    worker.postMessage({ type: 'REGISTER', meshId: 3, positions: new Float32Array(positions) });
    await new Promise(r => setTimeout(r, 10));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [{ meshId: 3, matrix: TRANSLATE_10_20_30 }]
    });

    const transformed = result.positions.subarray(result.offsets[0], result.offsets[1]);
    assertArraysEqual(transformed, expected, 'Translation should offset correctly');
    assertArraysEqual(transformed, [10, 20, 30, 11, 21, 31], 'Expected translated values');
  });

  // Test 4: Rotation transform
  await test('rotation Y 90° transforms correctly (worker)', async () => {
    const positions = new Float32Array([1, 0, 0]); // Point on X axis
    const expected = referenceTransform(positions, ROTATE_Y_90);

    worker.postMessage({ type: 'REGISTER', meshId: 4, positions: new Float32Array(positions) });
    await new Promise(r => setTimeout(r, 10));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [{ meshId: 4, matrix: ROTATE_Y_90 }]
    });

    const transformed = result.positions.subarray(result.offsets[0], result.offsets[1]);
    assertArraysEqual(transformed, expected, 'Rotation should match reference');
    // After Y rotation 90° (standard column-major), (1,0,0) becomes (0,0,-1)
    assertArraysEqual(transformed, [0, 0, -1], 'X-axis point should rotate around Y');
  });

  // Test 5: Combined transform
  await test('combined scale + translate works (worker)', async () => {
    const positions = new Float32Array([1, 1, 1]);
    const expected = referenceTransform(positions, SCALE_AND_TRANSLATE);

    worker.postMessage({ type: 'REGISTER', meshId: 5, positions: new Float32Array(positions) });
    await new Promise(r => setTimeout(r, 10));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [{ meshId: 5, matrix: SCALE_AND_TRANSLATE }]
    });

    const transformed = result.positions.subarray(result.offsets[0], result.offsets[1]);
    assertArraysEqual(transformed, expected, 'Combined transform should match reference');
    // (1,1,1) * 2 + (5,10,15) = (7, 12, 17)
    assertArraysEqual(transformed, [7, 12, 17], 'Expected (1,1,1)*2 + (5,10,15) = (7,12,17)');
  });

  // Test 6: Multiple meshes in single batch (packed buffer)
  await test('multiple meshes packed into single buffer (worker)', async () => {
    const mesh1 = new Float32Array([1, 0, 0]);
    const mesh2 = new Float32Array([0, 1, 0, 0, 0, 1]);
    const mesh3 = new Float32Array([1, 1, 1]);

    const expected1 = referenceTransform(mesh1, SCALE_2X);
    const expected2 = referenceTransform(mesh2, TRANSLATE_10_20_30);
    const expected3 = referenceTransform(mesh3, IDENTITY);

    worker.postMessage({ type: 'REGISTER', meshId: 10, positions: new Float32Array(mesh1) });
    worker.postMessage({ type: 'REGISTER', meshId: 11, positions: new Float32Array(mesh2) });
    worker.postMessage({ type: 'REGISTER', meshId: 12, positions: new Float32Array(mesh3) });
    await new Promise(r => setTimeout(r, 20));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [
        { meshId: 10, matrix: SCALE_2X },
        { meshId: 11, matrix: TRANSLATE_10_20_30 },
        { meshId: 12, matrix: IDENTITY }
      ]
    });

    assert(result.meshIds.length === 3, 'Should have 3 mesh results');
    assert(result.offsets.length === 4, 'Should have 4 offsets (3 meshes + end marker)');

    // Verify packed buffer structure
    const totalFloats = mesh1.length + mesh2.length + mesh3.length;
    assert(result.positions.length === totalFloats, `Packed buffer should have ${totalFloats} floats`);

    // Extract and verify each mesh's results
    for (let i = 0; i < result.meshIds.length; i++) {
      const meshId = result.meshIds[i];
      const start = result.offsets[i];
      const end = result.offsets[i + 1];
      const transformed = result.positions.subarray(start, end);

      if (meshId === 10) {
        assertArraysEqual(transformed, expected1, 'Mesh 10 should match reference');
      } else if (meshId === 11) {
        assertArraysEqual(transformed, expected2, 'Mesh 11 should match reference');
      } else if (meshId === 12) {
        assertArraysEqual(transformed, expected3, 'Mesh 12 should match reference');
      }
    }
  });

  // Test 7: Large mesh with many vertices
  await test('large mesh (10000 vertices) matches reference (worker)', async () => {
    const vertexCount = 10000;
    const positions = new Float32Array(vertexCount * 3);

    // Fill with deterministic test data
    for (let i = 0; i < positions.length; i++) {
      positions[i] = Math.sin(i * 0.1) * 100;
    }

    const expected = referenceTransform(positions, SCALE_AND_TRANSLATE);

    worker.postMessage({ type: 'REGISTER', meshId: 100, positions: new Float32Array(positions) });
    await new Promise(r => setTimeout(r, 20));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: [{ meshId: 100, matrix: SCALE_AND_TRANSLATE }]
    });

    const transformed = result.positions.subarray(result.offsets[0], result.offsets[1]);

    assert(transformed.length === expected.length, 'Should have same length');
    assertArraysEqual(transformed, expected, 'Large mesh should match reference exactly');
  });

  // Test 8: Verify offsets are correct for packed buffer extraction
  await test('packed buffer offsets enable correct subarray extraction', async () => {
    // Register meshes of different sizes
    const sizes = [3, 6, 9, 12]; // 1, 2, 3, 4 vertices
    const meshes = sizes.map((size, i) => {
      const positions = new Float32Array(size);
      for (let j = 0; j < size; j++) positions[j] = i + 1; // Fill with mesh index+1
      return positions;
    });

    meshes.forEach((m, i) => {
      worker.postMessage({ type: 'REGISTER', meshId: 200 + i, positions: new Float32Array(m) });
    });
    await new Promise(r => setTimeout(r, 20));

    const result = await workerRequest(worker, {
      type: 'TRANSFORM_BATCH',
      requests: meshes.map((_, i) => ({ meshId: 200 + i, matrix: IDENTITY }))
    });

    // Verify offset structure
    let expectedOffset = 0;
    for (let i = 0; i < meshes.length; i++) {
      assert(result.offsets[i] === expectedOffset, `Offset ${i} should be ${expectedOffset}`);
      expectedOffset += meshes[i].length;
    }
    assert(result.offsets[meshes.length] === expectedOffset, 'End marker should equal total size');

    // Verify each extracted subarray has correct content
    for (let i = 0; i < meshes.length; i++) {
      const extracted = result.positions.subarray(result.offsets[i], result.offsets[i + 1]);
      assertArraysEqual(extracted, meshes[i], `Mesh ${200 + i} content should match original`);
    }
  });

  // Cleanup
  await worker.terminate();

  // Summary
  console.log('\n=== Test Summary ===\n');
  console.log(`  Passed: ${testsPassed}`);
  console.log(`  Failed: ${testsFailed}`);
  console.log('');

  if (testsFailed > 0) {
    console.log('TESTS FAILED\n');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED\n');
  }
}

runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
