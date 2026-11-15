export const GOOGLE_TAG='GTM-5L5WVVS2',MEASUREMENT_ID='G-6MWD8RZ6FN';
export function analyticsPage(location,referrer=''){
 const url=new URL(location.href);
 if(url.origin!=='https://pant4321.github.io'||url.pathname!=='/draft-lab/'||url.hash.includes('companion='))return null;
 let previous='';
 try{const parsed=new URL(referrer);if(parsed.protocol==='https:')previous=parsed.origin+parsed.pathname;}catch{}
 return {page_location:url.origin+url.pathname,page_referrer:previous,allow_google_signals:false,allow_ad_personalization_signals:false};
}
export function startAnalytics(environment=globalThis){
 try{
  const page=analyticsPage(environment.location,environment.document.referrer);
  if(!page||environment.navigator.globalPrivacyControl||environment.draftLabAnalyticsStarted)return false;
  environment.draftLabAnalyticsStarted=true;
  environment.dataLayer=environment.dataLayer||[];
  environment.gtag=function(){environment.dataLayer.push(arguments);};
  // Set sanitized page fields before the tag can send its automatic page view.
  environment.gtag('set',page);environment.gtag('js',new Date());
  const script=environment.document.createElement('script');script.async=true;
  script.src='https://www.googletagmanager.com/gtm.js?id='+GOOGLE_TAG;
  script.referrerPolicy='no-referrer';environment.document.head.append(script);
  return true;
 }catch{return false;}
}
