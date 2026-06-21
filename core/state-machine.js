(function initializeStateMachine(app) {
  'use strict';

  class ScraperController {
    constructor() {
      this.runId = '';
      this.sessionToken = null;
      this.keywordToken = null;
      this.runningPromise = null;
      this.credentials = {};
    }

    async start(runId, credentials = {}) {
      if (this.runningPromise && this.runId === runId) return this.runningPromise;
      if (this.runningPromise) this.stop('superseded');
      this.runId = runId;
      this.credentials = { ...credentials };
      this.sessionToken = new app.utils.CancellationToken();
      this.runningPromise = this.run(runId)
        .catch((error) => this.handleFatal(error))
        .finally(() => {
          this.runningPromise = null;
          this.keywordToken = null;
        });
      return this.runningPromise;
    }

    stop(reason = 'stop') {
      const activePlatform = this.currentPlatform;
      if (activePlatform && app.scrapers[activePlatform]) app.scrapers[activePlatform].stop();
      this.keywordToken?.cancel(reason);
      this.sessionToken?.cancel(reason);
      try { window.scrollTo({ top: window.scrollY, behavior: 'auto' }); } catch (error) {}
    }

    skip() {
      this.keywordToken?.cancel('skip');
      try { window.scrollTo({ top: window.scrollY, behavior: 'auto' }); } catch (error) {}
    }

    async transition(state, phase, extra = {}) {
      const logger = new app.Logger(state.runId, state.platform);
      if (state.phase !== phase) await logger.transition(state.phase, phase);
      return app.storage.patch(state.runId, { phase, ...extra });
    }

    credentialsFor(platform) {
      const key = platform === 'facebook' ? 'facebook' : platform === 'instagram' ? 'instagram' : platform === 'twitter' ? 'twitter' : '';
      return key ? { ...(this.credentials[key] || {}) } : {};
    }

    async run(runId) {
      while (true) {
        this.sessionToken.throwIfCancelled();
        let state = await app.storage.getState();
        if (!state || state.runId !== runId || !state.active || state.requestedAction === 'stop') return;
        const scraper = app.scrapers[state.platform];
        if (!scraper) throw new Error(`Unsupported platform: ${state.platform}`);
        this.currentPlatform = state.platform;
        const logger = new app.Logger(runId, state.platform);

        if (state.requestedAction === 'skip') {
          await logger.info(`Skip applied before keyword work: ${state.currentKeyword}`);
          const continued = await this.advanceKeyword(state, logger, 'skip');
          if (!continued) return;
          continue;
        }

        this.keywordToken = new app.utils.CancellationToken(this.sessionToken);
        const navigation = new app.Navigation(logger, this.keywordToken);
        const keyword = state.currentKeyword;
        let currentCount = Number(state.stats?.currentKeyword || 0);
        await logger.info(`Keyword started: ${keyword}`);

        try {
          const ready = await scraper.ensureReady({
            state,
            logger,
            navigation,
            token: this.keywordToken,
            credentials: this.credentialsFor(state.platform)
          });
          if (!ready) throw new Error(`${state.platform} login is required`);

          state = await this.transition(state, 'searching', { requestedAction: null });
          const searchResult = await scraper.searchKeyword(keyword, {
            state,
            logger,
            navigation,
            token: this.keywordToken,
            credentials: this.credentialsFor(state.platform)
          });
          if (searchResult?.navigating) {
            await logger.info('Navigation started; state machine will resume after tab load');
            return;
          }

          state = await this.transition(state, 'scraping');
          const onPost = async (rawPost) => {
            this.keywordToken.throwIfCancelled();
            const post = app.utils.normalizePost(rawPost, { keyword, source: state.platform });
            const missing = app.utils.validatePost(post);
            if (missing.length) await logger.warn(`Post has empty required fields: ${missing.join(', ')}`, post.postUrl || 'URL unavailable');
            if (!post.postUrl || !post.postDate) {
              await logger.warn('Post skipped because URL or publication date is unavailable');
              return { accepted: false, invalid: true };
            }
            if (app.utils.isBeforeDateLimit(post.postDate, state.dateLimit)) {
              await logger.info(`Post skipped because it is older than ${state.dateLimit}`, post.postUrl);
              return { accepted: false, older: true };
            }
            const saved = await app.server.savePost(runId, post, { sendToServer: state.sendToServer });
            if (saved.stopped) {
              this.sessionToken.cancel('stop');
              this.sessionToken.throwIfCancelled();
            }
            if (saved.duplicate) {
              const latest = await app.storage.getState();
              await app.storage.patch(runId, { stats: { duplicates: Number(latest?.stats?.duplicates || 0) + 1 } });
              await logger.info('Duplicate post skipped', post.postUrl);
              return { accepted: false, duplicate: true };
            }
            currentCount++;
            const latest = await app.storage.getState();
            await app.storage.patch(runId, {
              stats: {
                currentKeyword: currentCount,
                total: Number(latest?.stats?.total || 0) + 1
              }
            });
            await logger.info(`Post saved (${currentCount}${state.targetCount === -1 ? '' : `/${state.targetCount}`})`, post.postUrl);
            return {
              accepted: true,
              limitReached: state.targetCount !== -1 && currentCount >= state.targetCount
            };
          };

          const result = await scraper.scrapePosts({
            state,
            runId,
            keyword,
            logger,
            navigation,
            token: this.keywordToken,
            credentials: this.credentialsFor(state.platform),
            targetCount: state.targetCount,
            currentCount: () => currentCount,
            onPost
          });
          await logger.info(`Keyword collection finished: ${keyword}`, result?.reason || 'completed');
          await scraper.cleanup();
          state = await app.storage.getState();
          if (!state?.active) return;
          const continued = await this.advanceKeyword(state, logger, result?.reason || 'completed');
          if (!continued) return;
          if (state.infiniteLoop && result?.reason === 'exhausted') await app.utils.sleep(5000, this.sessionToken);
        } catch (error) {
          if (!(error instanceof app.utils.CancellationError)) throw error;
          if (error.reason === 'skip') {
            await scraper.cleanup();
            state = await app.storage.getState();
            if (!state?.active) return;
            await logger.info(`Keyword skipped immediately: ${keyword}`);
            const continued = await this.advanceKeyword(state, logger, 'skip');
            if (!continued) return;
            continue;
          }
          return;
        }
      }
    }

    async advanceKeyword(state, logger, reason) {
      const nextIndex = state.keywordIndex + 1;
      if (nextIndex < state.keywords.length || state.infiniteLoop) {
        const keywordIndex = nextIndex < state.keywords.length ? nextIndex : 0;
        const currentKeyword = state.keywords[keywordIndex];
        await logger.info(`Moving to next keyword: ${currentKeyword}`, reason);
        await app.storage.patch(state.runId, {
          keywordIndex,
          currentKeyword,
          phase: 'searching',
          requestedAction: null,
          stats: { currentKeyword: 0 }
        });
        return true;
      }

      await logger.info('All keywords completed; waiting for the server queue');
      await app.storage.patch(state.runId, { active: false, phase: 'finalizing', requestedAction: null });
      await app.downloads.finalize(state.runId, false);
      return false;
    }

    async handleFatal(error) {
      if (error instanceof app.utils.CancellationError) return;
      console.error('Scraper fatal error', error);
      try {
        const state = await app.storage.getState();
        if (!state || state.runId !== this.runId) return;
        const logger = new app.Logger(this.runId, state.platform);
        await logger.error('Fatal scraper error', error.stack || error.message);
        await app.storage.patch(this.runId, {
          active: false,
          phase: 'failed',
          lastError: error.message,
          stats: { errors: Number(state.stats?.errors || 0) + 1 }
        });
        await app.downloads.finalize(this.runId, false);
      } catch (finalizeError) {
        console.error('Fatal finalization error', finalizeError);
      }
    }
  }

  app.ScraperController = ScraperController;
})(globalThis.ScraperApp);
