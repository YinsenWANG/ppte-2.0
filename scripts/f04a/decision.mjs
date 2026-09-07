/** Evidence gate only; never enables a product exporter. Unknown quality is not a pass. */
export function decidePDFRoute({browserQualified,externalQualified}) {
 if(browserQualified===true) return {conclusion:1,taskStatus:'validated-browser-route',hold:false,canStartF04:true,needsArchitectureDecision:false};
 if(externalQualified===true) return {conclusion:2,taskStatus:'awaiting-user-decision',hold:true,canStartF04:false,needsArchitectureDecision:true};
 return {conclusion:3,taskStatus:'validated-no-passing-route',hold:false,canStartF04:false,needsArchitectureDecision:false};
}
