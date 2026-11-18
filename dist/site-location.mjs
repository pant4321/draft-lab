export function isLiveSite(url){
 return (url.origin==='https://draftedge.website'&&url.pathname==='/')||
  (url.origin==='https://pant4321.github.io'&&url.pathname==='/draft-lab/');
}
