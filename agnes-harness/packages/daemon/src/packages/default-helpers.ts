import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUNDLED_HELPERS,
  bundledPluginSourceRoot,
  hashDirectory,
  type InstalledInventory,
  isRuntimePackageEligible,
  isSnapshotPackageEligible,
  lockPath,
  type PackageManager,
  parseSource,
} from '@agnes/package-manager'

import type { RuntimeTargetArtifact } from '@agnes/plugin-runtime/host'
import { rebuildDesiredFromInventory } from '../composite-desired.js'
import { withDefaultHelperState } from './default-helper-state.js'

/** Provision missing release-owned defaults once; preserve installed packages and later user choices. */
export async function initializeDefaultHelpers(options: {
  profileDir: string
  manager: PackageManager
  initializePolicy(): Promise<void>
}): Promise<void> {
  let refreshVerifier:
    | {
        id: string
        source: ReturnType<typeof parseSource>
        expectedIntegrity: string
        preserveEnabled: boolean
      }
    | undefined
  await withDefaultHelperState(options.profileDir, async (state, save) => {
    if (!state || state.phase === 'existing' || state.version < 3) {
      const inventory = existsSync(lockPath(options.profileDir))
        ? await options.manager.inventory(options.profileDir)
        : undefined
      const integrity: Record<string, string> =
        state && ['pending', 'installed'].includes(state.phase) ? { ...state.integrity } : {}
      for (const helper of BUNDLED_HELPERS) {
        if (
          state?.version === 1 &&
          state.phase !== 'existing' &&
          !['plugin-helper', 'document-reader', 'agnes-science'].includes(helper.name)
        )
          continue
        if (state?.version === 2 && !['document-reader', 'agnes-science'].includes(helper.name)) continue
        if (inventory?.packages.some((pkg) => pkg.id === helper.id)) continue
        const root = bundledPluginSourceRoot(helper.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        integrity[helper.id] = hashDirectory(join(root, 'bundled-plugins', helper.name))
      }
      state = { version: 7, phase: 'pending', integrity }
      // This intent precedes policy creation, so a failed first startup can resume safely.
      save(state)
    } else if (state.version === 3) {
      // Add newly shipped defaults without replaying the old helper set. This preserves a user's
      // explicit removal/disable choices while making the bundled science package available.
      const science = BUNDLED_HELPERS.find((helper) => helper.name === 'agnes-science')
      if (!science || Object.hasOwn(state.integrity, science.id)) state = { ...state, version: 4 }
      else {
        const root = bundledPluginSourceRoot(science.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        const inventory = existsSync(lockPath(options.profileDir))
          ? await options.manager.inventory(options.profileDir)
          : undefined
        const installed = inventory?.packages.some((pkg) => pkg.id === science.id) ?? false
        const integrity = {
          ...(state.phase === 'complete' ? {} : state.integrity),
          [science.id]: hashDirectory(join(root, 'bundled-plugins', science.name)),
        }
        state = {
          version: 4,
          phase:
            state.phase === 'complete' && installed
              ? 'complete'
              : state.phase === 'complete'
                ? 'pending'
                : state.phase,
          integrity,
        }
      }
      save(state)
    }
    // Version 4 profiles were released before the research-verifier client module existed.
    // Add only helpers absent from the receipt: an absent id means it was not part of the
    // user's previous default set, while a present id preserves an explicit removal/disable.
    if (state?.version === 4) {
      const verifier = BUNDLED_HELPERS.find((helper) => helper.name === 'research-verifier')
      if (verifier) {
        const root = bundledPluginSourceRoot(verifier.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        const expectedIntegrity = hashDirectory(join(root, 'bundled-plugins', verifier.name))
        const inventory = existsSync(lockPath(options.profileDir))
          ? await options.manager.inventory(options.profileDir)
          : undefined
        const installed = inventory?.packages.find((pkg) => pkg.id === verifier.id)
        const hadVerifier = Object.hasOwn(state.integrity, verifier.id)
        const packageChanged = installed !== undefined && installed.entry.integrity !== expectedIntegrity
        const integrity = { ...state.integrity, [verifier.id]: expectedIntegrity }
        state = {
          version: 5,
          phase: state.phase === 'complete' && !hadVerifier ? 'pending' : state.phase,
          integrity,
        }
        if (state.phase === 'complete' && packageChanged)
          refreshVerifier = {
            id: verifier.id,
            source: parseSource(verifier.ref),
            expectedIntegrity,
            preserveEnabled: installed?.entry.state.enabled ?? true,
          }
        save(state)
      } else {
        state = { ...state, version: 5 }
        save(state)
      }
    }
    if (state.version === 5) {
      // v5 pinned a verifier service name that the host refuses (multi-agent).
      // Supersede only that unfinished release-owned intent; completed profiles
      // and every other helper retain their pins and the user's lifecycle choices.
      const verifier = BUNDLED_HELPERS.find((helper) => helper.name === 'research-verifier')
      if (verifier && state.phase !== 'complete' && Object.hasOwn(state.integrity, verifier.id)) {
        const root = bundledPluginSourceRoot(verifier.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        state = {
          ...state,
          version: 6,
          phase: 'pending',
          integrity: {
            ...state.integrity,
            [verifier.id]: hashDirectory(join(root, 'bundled-plugins', verifier.name)),
          },
        }
      } else state = { ...state, version: 6 }
      save(state)
    }
    if (state.version === 6) {
      // Bundled verifier bytes changed again (sidebar footer entry + fullscreen page). A
      // receipt refreshes only when its pin still matches the installed tree and the current
      // source differs; foreign pins and absent pins stay fail-closed, preserving explicit
      // removals and interrupted-integrity rejections.
      const verifier = BUNDLED_HELPERS.find((helper) => helper.name === 'research-verifier')
      if (!verifier) {
        state = { ...state, version: 7 }
        save(state)
      } else {
        const root = bundledPluginSourceRoot(verifier.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        const expectedIntegrity = hashDirectory(join(root, 'bundled-plugins', verifier.name))
        const pinned = Object.hasOwn(state.integrity, verifier.id)
        const inventory = existsSync(lockPath(options.profileDir))
          ? await options.manager.inventory(options.profileDir)
          : undefined
        const installed = inventory?.packages.find((pkg) => pkg.id === verifier.id)
        if (
          pinned &&
          installed !== undefined &&
          installed.entry.integrity === state.integrity[verifier.id] &&
          installed.entry.integrity !== expectedIntegrity
        ) {
          const integrity = { ...state.integrity, [verifier.id]: expectedIntegrity }
          if (state.phase === 'complete') {
            // Keep the v6 receipt until refreshVerifier has fully updated, trusted, and
            // enabled the snapshot. Writing v7 here would make a failed update look complete
            // on the next daemon start and permanently skip the retry path.
            refreshVerifier = {
              id: verifier.id,
              source: parseSource(verifier.ref),
              expectedIntegrity,
              preserveEnabled: installed.entry.state.enabled ?? true,
            }
            // The new pin is committed together with the successful update below.
          } else {
            state = { ...state, version: 7, phase: 'pending', integrity }
          }
        } else {
          state = { ...state, version: 7 }
        }
        save(state)
      }
    }
    // Recover a v7 receipt written by an older migration implementation before its package
    // update committed. The receipt already carries the current source pin, so a complete
    // state with a same-source older snapshot is an interrupted refresh, not a user removal.
    if (state.version === 7 && state.phase === 'complete') {
      const verifier = BUNDLED_HELPERS.find((helper) => helper.name === 'research-verifier')
      if (verifier && Object.hasOwn(state.integrity, verifier.id)) {
        const root = bundledPluginSourceRoot(verifier.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        const expectedIntegrity = hashDirectory(join(root, 'bundled-plugins', verifier.name))
        const inventory = existsSync(lockPath(options.profileDir))
          ? await options.manager.inventory(options.profileDir)
          : undefined
        const installed = inventory?.packages.find((pkg) => pkg.id === verifier.id)
        if (
          installed !== undefined &&
          installed.entry.source.ref === verifier.ref &&
          state.integrity[verifier.id] === expectedIntegrity &&
          installed.entry.integrity !== expectedIntegrity
        ) {
          refreshVerifier = {
            id: verifier.id,
            source: parseSource(verifier.ref),
            expectedIntegrity,
            preserveEnabled: installed.entry.state.enabled ?? true,
          }
        }
      }
      // Refresh the bundled science package when a completed release receipt still pins the
      // previous bundled bytes. Existing explicit removals and foreign package rows are preserved.
      const science = BUNDLED_HELPERS.find((helper) => helper.name === 'agnes-science')
      if (science && Object.hasOwn(state.integrity, science.id)) {
        const root = bundledPluginSourceRoot(science.ref)
        if (!root) throw new Error('Bundled helper source unavailable')
        const inventory = existsSync(lockPath(options.profileDir))
          ? await options.manager.inventory(options.profileDir)
          : undefined
        const installed = inventory?.packages.find((pkg) => pkg.id === science.id)
        if (
          installed !== undefined &&
          installed.entry.source.ref === science.ref &&
          installed.entry.integrity === state.integrity[science.id] &&
          installed.entry.version !== science.version
        ) {
          const expectedIntegrity = hashDirectory(join(root, 'bundled-plugins', science.name))
          state = {
            ...state,
            phase: 'pending',
            integrity: { ...state.integrity, [science.id]: expectedIntegrity },
          }
          save(state)
        }
      }
    }
    await options.initializePolicy()
    if (refreshVerifier) {
      await options.manager.recover(options.profileDir)
      const preview = await options.manager.inspect(options.profileDir, refreshVerifier.source)
      if (
        preview.id !== refreshVerifier.id ||
        preview.integrity !== refreshVerifier.expectedIntegrity ||
        preview.blockers.length ||
        !preview.capabilityHash
      )
        throw new Error('Bundled helper verification failed')
      await options.manager.update(options.profileDir, refreshVerifier.id, refreshVerifier.source, {
        expectedIntegrity: refreshVerifier.expectedIntegrity,
      })
      await options.manager.trust(options.profileDir, refreshVerifier.id, {
        integrity: preview.integrity,
        capabilityHash: preview.capabilityHash,
      })
      await options.manager.setEnabled(
        options.profileDir,
        refreshVerifier.id,
        refreshVerifier.preserveEnabled,
        {
          expectedInstalledIntegrity: preview.integrity,
        },
      )
      state = { ...state, phase: 'complete' }
      state = {
        ...state,
        version: 7,
        integrity: { ...state.integrity, [refreshVerifier.id]: refreshVerifier.expectedIntegrity },
      }
      save(state)
      return
    }
    if (state.phase !== 'pending') return
    await options.manager.recover(options.profileDir)
    for (const helper of BUNDLED_HELPERS) {
      if (!Object.hasOwn(state.integrity, helper.id)) continue
      const source = parseSource(helper.ref)
      const preview = await options.manager.inspect(options.profileDir, source)
      const installed = (await options.manager.inventory(options.profileDir)).packages.find(
        (p) => p.id === helper.id,
      )
      if (
        preview.id !== helper.id ||
        preview.version !== helper.version ||
        preview.blockers.length ||
        !preview.capabilityHash
      )
        throw new Error('Bundled helper verification failed')
      if (preview.integrity !== state.integrity[helper.id]) {
        // A separately approved package update can outlive an interrupted bootstrap receipt.
        // Reconcile only against verified, trusted bytes with the same source and capabilities;
        // a changed release alone never grants authority to replace the pinned receipt.
        if (
          !installed ||
          !isSnapshotPackageEligible(installed) ||
          installed.entry.source.ref !== helper.ref ||
          installed.entry.version !== helper.version ||
          installed.entry.integrity !== preview.integrity ||
          installed.capabilityHash !== preview.capabilityHash
        )
          throw new Error('Bundled helper verification failed')
        state = { ...state, integrity: { ...state.integrity, [helper.id]: preview.integrity } }
        save(state)
      }
      const refreshExisting =
        installed !== undefined &&
        (installed.entry.integrity !== preview.integrity || installed.entry.source.ref !== helper.ref)
      const enabled = installed && isSnapshotPackageEligible(installed) ? installed.enabled : true
      if (refreshExisting)
        await options.manager.update(options.profileDir, helper.id, source, {
          expectedIntegrity: preview.integrity,
        })
      if (!installed)
        await options.manager.install(options.profileDir, source, { expectedIntegrity: preview.integrity })
      await options.manager.trust(options.profileDir, helper.id, {
        integrity: preview.integrity,
        capabilityHash: preview.capabilityHash,
      })
      await options.manager.setEnabled(options.profileDir, helper.id, enabled, {
        expectedInstalledIntegrity: preview.integrity,
      })
    }
    state = { ...state, phase: Object.keys(state.integrity).length ? 'installed' : 'complete' }
    save(state)
  })
}

/** Finish first boot through the same pinned/probed target publication as ordinary plugins. */
export async function activateDefaultHelpers(options: {
  profileDir: string
  inventory: InstalledInventory
  previous: RuntimeTargetArtifact | undefined
  publish(target: RuntimeTargetArtifact): Promise<void>
}): Promise<void> {
  await withDefaultHelperState(options.profileDir, async (state, save) => {
    if (state?.phase !== 'installed') return
    let target = options.previous
    for (const helper of BUNDLED_HELPERS) {
      if (!Object.hasOwn(state.integrity, helper.id)) continue
      const pkg = options.inventory.packages.find((p) => p.id === helper.id)
      if (!pkg || !isSnapshotPackageEligible(pkg) || pkg.entry.integrity !== state.integrity[helper.id])
        throw new Error('Bundled helper activation verification failed')
      if (!isRuntimePackageEligible(pkg)) continue
      target = rebuildDesiredFromInventory({
        previous: target,
        inventory: options.inventory,
        packageId: helper.id,
        operation: 'enable',
      })
    }
    if (target) await options.publish(target)
    save({ ...state, phase: 'complete' })
  })
}
