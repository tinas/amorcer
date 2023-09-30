#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import minimist from 'minimist'
import prompts from 'prompts'
import { cyan, green, magenta, red, reset } from 'kolorist'

const argv = minimist(process.argv.slice(2), { string: ['_'] })
const cwd = process.cwd()

const LAYOUTS = [
  {
    name: 'pug',
    display: 'Pug',
    color: red,
    variants: [
      {
        name: 'pug-scss',
        display: 'Pug scss',
        color: magenta,
      },
      {
        name: 'pug-css',
        display: 'Pug CSS',
        color: cyan,
      },
    ],
  },
  {
    name: 'html',
    display: 'HTML',
    color: green,
    variants: [
      {
        name: 'html-scss',
        display: 'HTML Scss',
        color: magenta,
      },
      {
        name: 'html-css',
        display: 'HTML CSS',
        color: cyan,
      },
    ],
  },
]

const TEMPLATES = LAYOUTS.map(f => f.variants.map(v => v.name)).reduce((a, b) => a.concat(b), [])

const renameFiles = {
  _gitignore: '.gitignore',
}

const DEFAULT_TARGET_DIR = 'loom-project'

function formatTargetDir(targetDir) {
  return targetDir?.trim().replace(/\/+$/g, '')
}

function copy(src, destination) {
  const stat = fs.statSync(src)

  if (stat.isDirectory()) {
    copyDir(src, destination)
  } else {
    fs.copyFileSync(src, destination)
  }
}

function copyDir(srcDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true })

  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    const destinationFile = path.resolve(destinationDir, file)
    copy(srcFile, destinationFile)
  }
}

function isEmpty(path) {
  const files = fs.readdirSync(path)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) {
    return
  }

  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') {
      continue
    }
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
  }
}

function pkgFromUserAgent(userAgent) {
  if (!userAgent) return undefined

  const pkgSpec = userAgent.split(' ')[0]
  const pkgSpecArr = pkgSpec.split('/')

  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  }
}

function isValidPackageName(projectName) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(projectName)
}

function toValidPackageName(projectName) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-')
}

async function init() {
  const argTargetDir = formatTargetDir(argv._[0])
  const argTemplate = argv.template || argv.t

  const getProjectName = () => (targetDir === '.' ? path.basename(path.resolve()) : targetDir)
  let targetDir = argTargetDir || DEFAULT_TARGET_DIR
  let result

  try {
    result = await prompts(
      [
        {
          type: argTargetDir ? null : 'text',
          name: 'projectName',
          message: reset('Project name:'),
          initial: DEFAULT_TARGET_DIR,
          onState: state => {
            targetDir = formatTargetDir(state.value) || DEFAULT_TARGET_DIR
          },
        },
        {
          type: () => (!fs.existsSync(targetDir) || isEmpty(targetDir) ? null : 'confirm'),
          name: 'overwrite',
          message: () =>
            (targetDir === '.' ? 'Current directory' : `Target directory "${targetDir}"`) +
            'is not empty. Remove existing files and continue?',
        },
        {
          type: (_, { overwrite }) => {
            if (overwrite === false) {
              throw new Error(red('✖') + ' Operation cancelled!')
            }
            return null
          },
          name: 'overwriteChecker',
        },
        {
          type: () => (isValidPackageName(getProjectName()) ? null : 'text'),
          name: 'packageName',
          message: reset('Package name:'),
          initial: () => toValidPackageName(getProjectName()),
          validate: dir => isValidPackageName(dir) || 'Invalid package.json name',
        },
        {
          type: argTemplate && TEMPLATES.includes(argTemplate) ? null : 'select',
          name: 'framework',
          message:
            typeof argTemplate === 'string' && !TEMPLATES.includes(argTemplate)
              ? reset(`"${argTemplate}" isn't a valid template. Please choose from below: `)
              : reset('Select a framework: '),
          initial: 0,
          choices: LAYOUTS.map(framework => {
            const frameworkColor = framework.color
            return {
              title: frameworkColor(framework.display || framework.name),
              value: framework,
            }
          }),
        },
        {
          type: framework => (framework && framework.variants ? 'select' : null),
          name: 'variant',
          message: reset('Select a variant: '),
          choices: framework =>
            framework.variants.map(variant => {
              const variantColor = variant.color
              return {
                title: variantColor(variant.display || variant.name),
                value: variant.name,
              }
            }),
        },
      ],
      {
        onCancel: () => {
          throw new Error(red('✖') + ' Operation cancelled!')
        },
      },
    )
  } catch (cancelled) {
    console.log(cancelled.message)
    return
  }

  // user choice associated with prompts
  const { framework, overwrite, packageName, variant } = result

  const root = path.join(cwd, targetDir)

  if (overwrite) {
    emptyDir(root)
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true })
  }

  // determine template
  let template = variant || framework?.name || argTemplate

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)
  const pkgManager = pkgInfo ? pkgInfo.name : 'npm'

  console.log(`\nScaffolding project in ${root}...`)

  const templateDir = path.resolve(fileURLToPath(import.meta.url), '../packages', `template-${template}`)

  const write = (file, content) => {
    const targetPath = path.join(root, renameFiles[file] ?? file)

    if (content) {
      fs.writeFileSync(targetPath, content)
    } else {
      copy(path.join(templateDir, file), targetPath)
    }
  }

  const files = fs.readdirSync(templateDir)

  for (const file of files.filter(f => f !== 'package.json')) {
    write(file)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8'))

  pkg.name = packageName || getProjectName()

  write('package.json', JSON.stringify(pkg, null, 2) + '\n')

  const cdProjectName = path.relative(cwd, root)

  console.log('\nDone. Now run:\n')

  if (root !== cwd) {
    console.log(`  cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`)
  }

  switch (pkgManager) {
    case 'yarn':
      console.log('  yarn')
      console.log('  yarn dev')
      break
    default:
      console.log(`  ${pkgManager} install`)
      console.log(`  ${pkgManager} run dev`)
      break
  }
}

init().catch(e => {
  console.error(e)
})
