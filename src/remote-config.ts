import { PostHog } from './posthog-core'
import { RemoteConfig } from './types'

import { createLogger } from './utils/logger'
import { assignableWindow } from './utils/globals'

const logger = createLogger('[Decide]')

export class RemoteConfigLoader {
    constructor(private readonly instance: PostHog) {}

    private _loadRemoteConfigJs(cb: (config?: RemoteConfig) => void): void {
        if (assignableWindow.__PosthogExtensions__?.loadExternalDependency) {
            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'remote-config', () => {
                return cb(assignableWindow._POSTHOG_CONFIG)
            })
        } else {
            logger.error('PostHog Extensions not found. Cannot load remote config.')
            cb()
        }
    }

    private _loadRemoteConfigJSON(cb: (config?: RemoteConfig) => void): void {
        this.instance._send_request({
            method: 'GET',
            url: this.instance.requestRouter.endpointFor('assets', `/array/${this.instance.config.token}/config`),
            callback: (response) => {
                cb(response.json as RemoteConfig | undefined)
            },
        })
    }

    load(): void {
        // Call decide to get what features are enabled and other settings.
        // As a reminder, if the /decide endpoint is disabled, feature flags, toolbar, session recording, autocapture,
        // and compression will not be available.

        if (!this.instance.config.__preview_remote_config) {
            return
        }

        // Attempt 1 - use the pre-loaded config if it came as part of the token-specific array.js
        if (assignableWindow._POSTHOG_CONFIG) {
            logger.info('Using preloaded remote config', assignableWindow._POSTHOG_CONFIG)
            this.onRemoteConfig(assignableWindow._POSTHOG_CONFIG)
            return
        }

        if (this.instance.config.advanced_disable_decide) {
            // This setting is essentially saying "dont call external APIs" hence we respect it here
            logger.warn('Remote config is disabled. Falling back to local config.')
            return
        }

        // Attempt 2 - if we have the external deps loader then lets load the script version of the config that includes site apps
        this._loadRemoteConfigJs((config) => {
            if (!config) {
                logger.info('No config found after loading remote JS config. Falling back to JSON.')
                // Attempt 3 Load the config json instead of the script - we won't get site apps etc. but we will get the config
                this._loadRemoteConfigJSON((config) => {
                    this.onRemoteConfig(config)
                })
                return
            }

            this.onRemoteConfig(config)
        })
    }

    private onRemoteConfig(config?: RemoteConfig): void {
        // NOTE: Once this is rolled out we will remove the "decide" related code above. Until then the code duplication is fine.
        if (!config) {
            logger.error('Failed to fetch remote config from PostHog.')
            return
        }
        this.instance._onRemoteConfig(config)

        // We only need to reload if we haven't already loaded the flags or if the request is in flight
        if (config.hasFeatureFlags !== false) {
            // If the config has feature flags, we need to call decide to get the feature flags
            // This completely separates it from the config logic which is good in terms of separation of concerns
            this.instance.featureFlags.ensureFlagsLoaded()
        }
    }
}
