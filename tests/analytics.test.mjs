import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyticsPage,startAnalytics,GOOGLE_TAG} from '../dist/analytics.mjs';
const live='https://draftedge.website/';
test('analytics sends only the canonical live page and sanitized referrer, excluding tokens, search, and localhost',()=>{
 const value=analyticsPage({href:live+'?secret=x#anything'},'https://example.com/from?secret=y#token');
 assert.equal(value.page_location,live);assert.equal(value.page_referrer,'https://example.com/from');
 assert.equal(value.allow_google_signals,false);assert.equal(value.allow_ad_personalization_signals,false);
 assert.equal(analyticsPage({href:live+'#companion=private&port=8766'}),null);
 assert.ok(analyticsPage({href:'https://pant4321.github.io/draft-lab/'}));
 assert.equal(analyticsPage({href:live+'privacy.html'}),null);
 assert.equal(analyticsPage({href:'http://127.0.0.1:8765/'}),null);
 assert.equal(analyticsPage({href:'https://pant4321.github.io/uma-legacy/'}),null);
 assert.equal(analyticsPage({href:live},'http://127.0.0.1:8766/#token').page_referrer,'');
});
test('analytics initializes once without blocking the app, and honors the browser privacy signal',()=>{
 const scripts=[],environment={location:{href:live},navigator:{},document:{referrer:'',createElement:()=>({}),head:{append:script=>scripts.push(script)}}};
 assert.equal(startAnalytics(environment),true);assert.equal(startAnalytics(environment),false);
 assert.equal(scripts.length,1);assert.equal(scripts[0].src,'https://www.googletagmanager.com/gtm.js?id='+GOOGLE_TAG);
 assert.equal(scripts[0].async,true);assert.equal(scripts[0].referrerPolicy,'no-referrer');
 assert.equal(environment.dataLayer[0][0],'set');assert.equal(environment.dataLayer[0][1].page_location,live);
 assert.equal(startAnalytics({...environment,draftLabAnalyticsStarted:false,navigator:{globalPrivacyControl:true}}),false);
 assert.equal(startAnalytics({}),false);
 const entry=readFileSync(new URL('../dist/draft.mjs',import.meta.url),'utf8');
 assert.ok(entry.indexOf('const companionSession=prepareCompanionSession();')<entry.indexOf('startAnalytics();'));
});
