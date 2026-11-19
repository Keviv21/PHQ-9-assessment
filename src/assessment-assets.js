import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { hashBytes } from './assessment-content.js';

export function assetPath(root, key) {
  if (!/^[a-f0-9]{2}\/[a-f0-9]{64}$/.test(key) || key.slice(0, 2) !== key.slice(3, 5)) throw new Error('Invalid asset storage key.');
  return join(root, key);
}

export async function archiveAssets(bundle, { sourceRoot, assetRoot, dryRun = false }) {
  const allowedRoot = await realpath(sourceRoot);
  const files = new Map(), links = new Map();
  let missing = 0;
  for (const assessment of bundle.assessments) {
    const references = [];
    for (const asset of assessment.assets || []) {
      let sha256 = null;
      if (asset.archive_path) {
        const path = await realpath(resolve(allowedRoot, asset.archive_path));
        const rel = relative(allowedRoot, path);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Asset outside source archive: ${asset.id}`);
        if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`Missing asset checksum: ${asset.id}`);
        sha256 = asset.sha256;
        // Always verify each referenced path, including duplicates.
        const bytes = await readFile(path);
        if (hashBytes(bytes) !== sha256) throw new Error(`Asset checksum mismatch: ${asset.id} in ${assessment.assessment_id}`);
        if (!files.has(sha256)) {
          const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
          if (!dryRun) {
            const dest = assetPath(assetRoot, storageKey);
            await mkdir(resolve(dest, '..'), { recursive: true, mode: 0o700 });
            try { await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 }); }
            catch (error) {
              if (error.code !== 'EEXIST') throw error;
              if (hashBytes(await readFile(dest)) !== sha256) throw new Error('Existing archive asset is corrupt.');
            }
          }
          files.set(sha256, { sha256, storageKey, mimeType: asset.mime_type ?? 'application/octet-stream', byteSize: bytes.length });
        }
      } else missing++;
      references.push({ id: asset.id, sha256, metadata: { ...asset, displayApproved: false } });
    }
    links.set(assessment.assessment_id, references);
  }
  return { assets: [...files.values()], links, missing };
}

export function selectDisplayAssets(entry, links, selections = []) {
  const result = [];
  for (const selection of selections.filter(s => s.assessmentId === entry.assessment_id)) {
    const link = links.find(a => a.id === selection.assetId);
    if (!link?.sha256 || selection.sha256 !== link.sha256 || !selection.reviewedBy || !selection.reviewedOn || !selection.reuseBasis || !selection.alt) throw new Error('Display asset requires an exact checksum, reviewer, reuse basis and alt text.');
    if (!['image/png', 'image/jpeg'].includes(link.metadata.mime_type) || ['website_decoration', 'sample_report_not_runtime_context', 'source_snapshot'].includes(link.metadata.role)) throw new Error('This archive asset cannot be used as a display image.');
    if (selection.questionId && !entry.questionnaire.items.some(q => q.id === selection.questionId)) throw new Error('Unknown image question.');
    link.metadata.displayApproved = true;
    link.metadata.displayReview = selection;
    result.push({ id: selection.assetId, sha256: link.sha256, questionId: selection.questionId ?? null, alt: selection.alt, caption: selection.caption ?? '' });
  }
  return result;
}
