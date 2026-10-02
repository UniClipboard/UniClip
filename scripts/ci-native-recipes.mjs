import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';

export const recipeWorkflows = new Set([
  '.github/workflows/build.yml', '.github/workflows/build-pr.yml', '.github/workflows/release.yml',
  '.github/workflows/android-build.yml', '.github/workflows/ios-build-check.yml',
]);
const gate = 'inputs.build_required && inputs.validation_passed';
const inputDefinitions = {
  build_required: { description: 'Compile the app; false only for explicitly classified validation-only changes', type: 'boolean', default: true },
  validation_passed: { description: 'All required upstream classification and validation jobs succeeded', type: 'boolean', default: true },
  build_reason: { description: 'Explanation recorded when compilation is unnecessary', type: 'string', default: 'Native build requested by caller.' },
};
const decisionStep = {
  name: 'Validate build decision',
  env: { VALIDATION_PASSED: '${{ inputs.validation_passed }}', BUILD_REQUIRED: '${{ inputs.build_required }}', BUILD_REASON: '${{ inputs.build_reason }}' },
  run: `if [ "$VALIDATION_PASSED" != 'true' ]; then
  echo 'Required upstream validation or classification did not succeed.' >&2
  exit 1
fi
if [ "$BUILD_REQUIRED" = 'false' ]; then
  printf 'Native compilation not required: %s\\n' "$BUILD_REASON" >> "$GITHUB_STEP_SUMMARY"
fi
`,
};
function readYaml(text) {
  if (typeof text !== 'string') throw new Error('Missing workflow snapshot');
  const document = parseDocument(text);
  if (document.errors.length || document.warnings.length) throw new Error('Ambiguous workflow YAML');
  const value = document.toJS();
  if (!value || typeof value !== 'object' || !value.jobs) throw new Error('Unsupported workflow');
  return JSON.parse(JSON.stringify(value));
}

// Ignore only the documented scheduler wrapper. Every other field—including
// commands, actions, native runner, env/secrets, cache, outputs and artifacts—
// remains in the comparison. Unknown wrapper shapes fail conservatively.
function nativeRecipe(workflow) {
  const inputs = workflow.on?.workflow_call?.inputs;
  for (const [name, definition] of Object.entries(inputDefinitions)) {
    if (inputs && Object.hasOwn(inputs, name)) {
      if (!isDeepStrictEqual(inputs[name], definition)) throw new Error('Unknown scheduling input');
      delete inputs[name];
    }
  }
  if (inputs && !Object.keys(inputs).length) delete workflow.on.workflow_call.inputs;
  if (workflow.on.workflow_call && !Object.keys(workflow.on.workflow_call).length) workflow.on.workflow_call = null;
  const job = workflow.jobs.build;
  if (!job || Object.keys(workflow.jobs).length !== 1) throw new Error('Unknown native job structure');
  if (isDeepStrictEqual(job.steps[0], decisionStep)) job.steps.shift();
  for (const step of job.steps) {
    if (step.if === `\${{ ${gate} }}`) delete step.if;
    else if (step.if === `\${{ ${gate} && steps.engine.outputs.source == 'commit' }}`) step.if = "steps.engine.outputs.source == 'commit'";
  }
  const runner = typeof job['runs-on'] === 'string' && job['runs-on'].match(/^\$\{\{ inputs\.build_required && inputs\.validation_passed && '([^']+)' \|\| 'ubuntu-latest' \}\}$/);
  if (runner) job['runs-on'] = runner[1];
  return workflow;
}
function orchestrationRecipe(workflow) {
  // Trigger and dependency scheduling can change without changing native code.
  // Manual input definitions and all non-orchestration job bodies stay compared.
  delete workflow.on.push;
  delete workflow.on.pull_request;
  delete workflow.concurrency;
  const changes = workflow.jobs.changes;
  if (changes) {
    const expected = { uses: './.github/workflows/ci-changes.yml' };
    if (changes.if !== undefined) expected.if = "${{ github.event_name != 'workflow_dispatch' }}";
    if (!isDeepStrictEqual(changes, expected)) throw new Error('Unknown classification caller');
    delete workflow.jobs.changes;
  }
  for (const name of ['android-build', 'ios-build-check', 'code-style', 'unit-tests']) {
    const job = workflow.jobs[name];
    if (!job) continue;
    if (job.uses !== `./.github/workflows/${name === 'unit-tests' ? 'test' : name}.yml`) throw new Error('Unknown implementation');
    delete job.if;
    delete job.needs;
    for (const key of Object.keys(inputDefinitions)) if (job.with) delete job.with[key];
    if (job.with && !Object.keys(job.with).length) delete job.with;
  }
  return workflow;
}

function releaseRecipe(workflow) {
  const notification = {
    name: 'Request issue release verification',
    env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}', RELEASE_TAG: '${{ inputs.tag_name }}' },
    run: [
      'gh api --method POST "repos/${{ github.repository }}/dispatches" \\',
      '  -f "event_type=issue-lifecycle-release" \\',
      '  -f "client_payload[tag_name]=${RELEASE_TAG}"', '',
    ].join('\n'),
  };
  const job = workflow.jobs['github-release'];
  if (!job?.steps) throw new Error('Unknown publisher structure');
  job.steps = job.steps.filter((step) => !isDeepStrictEqual(step, notification));
  return workflow;
}

export function sameNativeRecipe(path, before, after) {
  if (!recipeWorkflows.has(path)) return false;
  try {
    const normalize = path.endsWith('/release.yml') ? releaseRecipe
      : /\/(?:android-build|ios-build-check)\.yml$/.test(path) ? nativeRecipe : orchestrationRecipe;
    return isDeepStrictEqual(normalize(readYaml(before)), normalize(readYaml(after)));
  } catch {
    return false;
  }
}

export function classifierWorkflowOnly(text) {
  try {
    const workflow = readYaml(text);
    const job = workflow.jobs.classify;
    if (!job || Object.keys(workflow.jobs).length !== 1 || job['runs-on'] !== 'ubuntu-latest') return false;
    if (Object.keys(workflow).some((key) => !['name', 'on', 'permissions', 'jobs'].includes(key))) return false;
    if (Object.keys(job).some((key) => !['name', 'runs-on', 'outputs', 'steps'].includes(key))) return false;
    if (!isDeepStrictEqual(workflow.permissions, { contents: 'read' })) return false;
    const steps = job.steps.map((step) => {
      const copy = { ...step }; delete copy.name; delete copy.id; return copy;
    });
    return isDeepStrictEqual(steps, [
      { uses: 'actions/checkout@v6', with: { 'fetch-depth': 0, 'persist-credentials': false } },
      { uses: 'actions/setup-node@v6', with: { 'node-version-file': '.nvmrc' } },
      { run: 'npm ci --ignore-scripts' },
      { run: 'node scripts/ci-changes.mjs' },
    ]);
  } catch {
    return false;
  }
}
