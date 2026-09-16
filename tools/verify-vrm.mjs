// Deep semantic verification that an optimized VRM kept its VRM 1.0 metadata.
// Compares humanoid bones, expression morph binds (VRM 1.0 node-based format),
// and springBone colliders/groups between source and output — by RESOLVED NODE
// NAME / morph target name, not raw index, so an index remap that changes what a
// reference POINTS AT cannot slip through.
// Usage: node tools/verify-vrm.mjs <original.vrm> <optimized.vrm>
import fs from 'node:fs';

const [origPath, finPath] = process.argv.slice(2);
if (!origPath || !finPath) {
  console.error('usage: node tools/verify-vrm.mjs <original.vrm> <optimized.vrm>');
  process.exit(1);
}

function loadGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a GLB`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}
const orig = loadGlb(origPath), fin = loadGlb(finPath);
let issues = 0;
const bad = (msg) => { console.log('MISMATCH:', msg); issues++; };

const nodeName = (json, i) => (json.nodes?.[i]?.name ?? null);
// morph target names of the mesh attached to a node (VRM 1.0 binds reference nodes)
const morphNames = (json, nodeIdx) => {
  const m = json.nodes?.[nodeIdx]?.mesh;
  return m != null ? (json.meshes[m].extras?.targetNames ?? []) : [];
};

// --- humanoid: bone name -> node name ---
const oH = orig.extensions.VRMC_vrm.humanoid.humanBones;
const fH = fin.extensions.VRMC_vrm.humanoid.humanBones;
for (const [bone, ref] of Object.entries(oH)) {
  if (nodeName(orig, ref.node) !== nodeName(fin, fH[bone]?.node)) {
    bad(`humanoid bone "${bone}": ${nodeName(orig, ref.node)} != ${nodeName(fin, fH[bone]?.node)}`);
  }
}
console.log(`humanoid: ${Object.keys(oH).length} bones resolve to identical node names`);

// --- expressions: preset morph binds resolve to same named targets ---
const oE = orig.extensions.VRMC_vrm.expressions?.preset || {};
const fE = fin.extensions.VRMC_vrm.expressions?.preset || {};
for (const [emo, ex] of Object.entries(oE)) {
  const binds = ex.morphTargetBinds ?? [];
  const fBinds = fE[emo]?.morphTargetBinds ?? [];
  if (binds.length !== fBinds.length) { bad(`expression "${emo}" bind count ${binds.length} != ${fBinds.length}`); continue; }
  for (let i = 0; i < binds.length; i++) {
    const oTN = morphNames(orig, binds[i].node)[binds[i].index];
    const fTN = morphNames(fin, fBinds[i].node)[fBinds[i].index];
    if (oTN !== fTN || binds[i].weight !== fBinds[i].weight) {
      bad(`expression "${emo}" bind ${i}: target "${oTN}" w=${binds[i].weight} != "${fTN}" w=${fBinds[i].weight}`);
    }
  }
}
console.log(`expressions: ${Object.keys(oE).length} presets, all morph binds resolve identically`);

// --- springBone: colliders resolve to same node names; groups are index arrays ---
const oSB = orig.extensions.VRMC_springBone ?? {};
const fSB = fin.extensions.VRMC_springBone ?? {};
(oSB.colliders ?? []).forEach((c, i) => {
  const fc = fSB.colliders?.[i];
  if (nodeName(orig, c.node) !== nodeName(fin, fc?.node)) bad(`collider[${i}] node ${nodeName(orig, c.node)} != ${nodeName(fin, fc?.node)}`);
  if (JSON.stringify(c.shape) !== JSON.stringify(fc?.shape)) bad(`collider[${i}] shape drift`);
});
(oSB.colliderGroups ?? []).forEach((g, i) => {
  if (JSON.stringify(g.colliders) !== JSON.stringify(fSB.colliderGroups?.[i]?.colliders)) {
    bad(`colliderGroup[${i}] "${g.name}" collider index list drift`);
  }
});
(oSB.bones ?? []).forEach((b, i) => {
  const fb = fSB.bones?.[i];
  const refName = (x) => (x != null ? nodeName(orig, x) : null);
  const finRefName = (x) => (x != null ? nodeName(fin, x) : null);
  if (refName(b.node) !== finRefName(fb?.node)) bad(`springBone[${i}] node drift`);
  if (refName(b.center) !== finRefName(fb?.center)) bad(`springBone[${i}] center drift`);
});
console.log(`springBone: ${(oSB.colliders ?? []).length} colliders, ${(oSB.colliderGroups ?? []).length} groups, ${(oSB.bones ?? []).length} bones checked`);

if (issues) { console.log(`FAILED: ${issues} issue(s)`); process.exit(1); }
console.log('ALL SEMANTIC CHECKS PASSED');
