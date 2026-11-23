// Builds the complete output package: <Name>Page, <Name>TestData and
// <Name>.spec, generated together from one set of forms and properties so
// names, imports and parameters always line up.
import type { PageTestData, TestScenario } from '../../shared/types'
import type { FormSpec } from './forms'
import { generatePom, type PomInput, type PomResult } from './pom-generator'
import { renderSpec } from './spec'
import { renderTestData, scenarioIssues, suggestScenarios } from './test-data'

export type FileRole = 'page' | 'data' | 'spec'

export interface GeneratedFile {
  role: FileRole
  /** Path inside the package folder, e.g. "TestLogin/TestLoginPage.ts". */
  path: string
  name: string
  content: string
}

export interface ScenarioReport {
  form: FormSpec
  scenarios: TestScenario[]
  /** Scenario id → reasons it is skipped by the generated spec. */
  issues: Record<string, string[]>
  /** True when the scenarios are suggestions (the user has not edited them yet). */
  suggested: boolean
}

export interface GeneratedPackage {
  baseName: string
  folder: string
  pom: PomResult
  /** Empty when generation is blocked. */
  files: GeneratedFile[]
  /** Why no files were generated (nothing usable to put in a Page Object). */
  blocked?: string
  scenarios: ScenarioReport[]
  warnings: string[]
}

export interface PackageInput extends PomInput {
  /** User-edited scenarios per form method (missing forms get suggestions). */
  testData: PageTestData
}

/** "TestLoginPage" → "TestLogin". */
export function baseNameOf(className: string): string {
  return className.replace(/Page$/, '') || 'Generated'
}

export function generatePackage(input: PackageInput): GeneratedPackage {
  const pom = generatePom(input)
  const { language, moduleFormat } = input.options
  const ts = language === 'typescript'
  const ext = ts ? 'ts' : 'js'
  const baseName = baseNameOf(pom.className)
  const folder = baseName
  const scan = input.scan

  const scenarios: ScenarioReport[] = pom.forms.map((form) => {
    const stored = input.testData[form.method]
    const list = stored ?? suggestScenarios(form, scan.elements)
    return {
      form,
      scenarios: list,
      issues: Object.fromEntries(list.map((s) => [s.id, scenarioIssues(s, form)])),
      suggested: !stored,
    }
  })

  const warnings: string[] = []
  const unvalidated = pom.properties.filter((p) => !p.validated).length
  if (unvalidated) warnings.push(`${unvalidated} locator${unvalidated > 1 ? 's are' : ' is'} unvalidated and marked in ${pom.className}.${ext}.`)
  if (pom.forms.length === 0 && input.options.includeMethods) {
    warnings.push('No form with fields and a single submit button was found among the included elements, so the spec only has the page-load test.')
  }
  for (const r of scenarios) {
    const skipped = r.scenarios.filter((s) => r.issues[s.id]!.length > 0).length
    if (r.scenarios.length === 0) warnings.push(`${r.form.method}: no test cases. Add at least one in Test data.`)
    else if (skipped) warnings.push(`${r.form.method}: ${skipped} of ${r.scenarios.length} test cases need configuration and will be skipped until then.`)
    if (!r.form.message) warnings.push(`${r.form.method}: no error message element was found, so failure cases need their expected error text.`)
  }

  if (pom.properties.length === 0) {
    return { baseName, folder, pom, files: [], scenarios, warnings, blocked: blockedReason(input.elementIds.length, pom) }
  }

  const testData: PageTestData = Object.fromEntries(scenarios.map((r) => [r.form.method, r.scenarios]))
  const names = {
    page: `${pom.className}.${ext}`,
    data: `${baseName}TestData.${ext}`,
    spec: `${baseName}.spec.${ext}`,
  }
  // Playwright's TypeScript loader resolves extensionless imports; Node ESM needs ".js".
  const module = (file: string) => `./${file.replace(/\.(ts|js)$/, '')}${!ts && moduleFormat === 'esm' ? '.js' : ''}`

  const data = renderTestData({
    baseName,
    className: pom.className,
    specFile: names.spec,
    dataFile: names.data,
    title: scan.title,
    forms: pom.forms,
    scenarios: testData,
    language,
    moduleFormat,
  })
  const spec = renderSpec({
    baseName,
    className: pom.className,
    pageModule: module(names.page),
    dataModule: module(names.data),
    dataFile: names.data,
    title: scan.title,
    forms: pom.forms,
    hasExpectLoaded: pom.loadedChecks.length > 0,
    language,
    moduleFormat,
  })

  return {
    baseName,
    folder,
    pom,
    files: [
      { role: 'page', path: `${folder}/${names.page}`, name: names.page, content: pom.code },
      { role: 'data', path: `${folder}/${names.data}`, name: names.data, content: data },
      { role: 'spec', path: `${folder}/${names.spec}`, name: names.spec, content: spec },
    ],
    scenarios,
    warnings,
  }
}

function blockedReason(inScope: number, pom: PomResult): string {
  if (inScope === 0) return 'No elements are in scope. Tick elements in the list, or switch to All eligible.'
  const counts = new Map<string, number>()
  for (const x of pom.excluded) counts.set(x.reason, (counts.get(x.reason) ?? 0) + 1)
  const detail = [...counts].map(([reason, n]) => `${n} × ${reason}`).join(' ')
  return `None of the ${inScope} elements in scope has a usable locator. ${detail}`
}
