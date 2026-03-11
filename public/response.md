# Response to Reviewers

**Manuscript:** "Explaining Sustained Blockchain Decentralization with Quasi-Experiments: Resource Flexibility of Consensus Mechanisms"

**Journal:** Information Systems Research (ISR-2024-1198)

Reviews are in *gray/italic*. Revised text from the manuscript is in **blue blockquotes** (indented with >).

---

## 1. Senior Editor

*Based on my own reading of the paper and the review team's assessment I agree with the AE's summarization that articulates some key areas of focus on the revision. At the risk of being repetitive **more needs to be done to convince the reader that the issue is real, important and interesting**. Some of this stems from the style of writing perhaps. While engaging, **it comes across in some way as being more journalistic** (e.g. "A key question then is what are the tailwinds, if there are any, for sustained blockchain decentralization?") than that befitting a research paper. My sense is the review team is looking for a **clearer articulation of the theoretical gap and the practical impact** that motivates the study of this problem. I hope in the revised version we can see a clearer motivation, driven by both theory and practice, and a **tighter linkage between the major theoretical constructs and the empirical foundations**. This is another area for improvement and the review team has gone into good amount of detail, so I defer to those comments. There is also the issue of **the role of the three shocks** that has been raised by the review team. On one hand triangulation is good for identification and I suspect that this is the motivation that you all have for including them. But **the review team is not finding coherence** in your articulation as a result. My guess is more upfront work (outlined above and in the AEs report) will help on this issue as well.*

Thank you for the opportunity to revise our manuscript. We take the core diagnosis seriously: the original manuscript did not do enough to establish the problem as real, important, and intellectually interesting, and the writing style was at times more journalistic than rigorous. We have comprehensively addressed each concern in the revision. Below is a high-level overview of the key changes, followed by our results; detailed responses to every concern follow in the AE and Reviewer sections.

**1. Motivation (real, important, interesting).** The revised introduction establishes on three empirical and theoretical grounds that decentralization cannot be taken for granted, and makes explicit why the question is intellectually interesting through three counterarguments showing the relationship is theoretically ambiguous. See detailed response below.

**2. Writing style.** We have systematically revised the writing throughout to replace journalistic framing with precise, theoretically grounded language, with before/after examples below.

**3. Theory-empirics linkage.** Virtualization theory now serves three explicit roles: (a) motivating the construct of resource flexibility, (b) generating falsifiable predictions for each shock, and (c) providing the interpretive framework in each results section and the discussion. We also connect resource flexibility to Williamson's (1985) asset specificity framework. See our detailed response to the AE's "Role of theory" comment.

**4. Coherence of the three shocks.** We now explicitly articulate a measurement strategy linking all three shocks to resource flexibility as complementary tests along a spectrum from inflexible (ASICs) to moderately flexible (GPUs) to highly flexible (tokens). See detailed response below.

The table below summarizes our key results. Across three shocks that vary resource flexibility from inflexible (ASICs) to highly flexible (tokens), more flexible systems consistently recover faster--from over 6 months (Bitcoin/ASICs) to 43 days (Solana/tokens) to permanent improvement (Ethereum Merge):

| | **China Mining Ban** | **Hetzner Shutdown** | **Ethereum Merge** |
|---|---|---|---|
| **Date** | May 15, 2021 | Nov 2, 2022 | Sep 15, 2022 |
| **Shock type** | Policy | Infrastructure | Technical |
| **Treated chain** | Bitcoin (vs. Ethereum) | Solana (vs. synthetic control) | Ethereum (pre vs. post) |
| **Resource** | ASICs (BTC) vs. GPUs (ETH) | Staked tokens (SOL) | GPUs to staked tokens (ETH) |
| **Flexibility level** | Low vs. moderate | High | Moderate to high |
| **Method** | Difference-in-differences | Synthetic DiD | Event study |
| **Effect on entropy** | -0.209\*\*\* (0.048) | -0.378\*\*\* (SDiD); -0.291\*\*\* (0.033) | +1.262\*\*\* (0.037) |
| **Effect on nodes** | +5.050\*\*\* | -326\*\*\* (SDiD); -337\*\*\* (27.5) | +694\*\*\* |
| **Recovery time** | >6 months | ~43 days | N/A (permanent shift) |
| **Observations** | 1,202 | 42 (SDiD); 121 (event) | 455 |

**Summary:** Across all three shocks, more flexible consensus resources are associated with faster recovery and broader participation--a consistent gradient from ASICs (slowest recovery, lasting centralization) to GPUs (minimal decline) to tokens (fastest recovery, permanent decentralization gains).

Notes: \*p<0.05, \*\*p<0.01, \*\*\*p<0.001. Standard errors in parentheses. Entropy is measured in bits using Shannon entropy (which captures both the number and evenness of participants). Recovery time for Hetzner calculated as 0.344/0.008 = 43 days from the event study slope.

We now address each concern in turn.

**1. Motivation: real, important, and interesting.** The SE identifies the core challenge: the original manuscript did not convincingly establish that decentralization is a real, important, and intellectually interesting problem. We have restructured the introduction to address each dimension with specific evidence.

*Real.* The revised introduction establishes that decentralization faces countervailing forces from multiple directions--economic, design-based, and empirical:

> Section 1: While many tout the decentralized nature of blockchain technology, it is still unclear whether blockchains are actually becoming more centralized or decentralized over time and, perhaps more importantly, what drives blockchain centralization or decentralization. Indeed, decentralization faces countervailing economic forces, including economies of scale and coordination costs (Hui and Tucker, 2023). It also faces economic trade-offs with blockchain's other goals, such as net neutrality and permissionlessness (Halaburda and Obermeier, 2024; Bakos et al., 2021). Recent empirical work also estimates that several key subsystems of blockchain ecosystems are becoming more centralized (Ju et al., 2025). In short, decentralization cannot be taken for granted; it must be actively sustained against countervailing economic and technical forces.

This paragraph, which now opens the second page of the introduction, makes the case that decentralization is a real and ongoing challenge--not an inherent property of blockchains but something that requires active enablers. The three-pronged structure (economic forces, design trade-offs, empirical evidence) directly addresses the SE's concern that the problem's reality was not established.

*Important.* The revised introduction foregrounds the practical stakes with specific catastrophic failures and the growing scale of economic activity on blockchains:

> Section 1: While too much decentralization can be bad for blockchain governance (Chen et al., 2021), failure to sustain decentralization in blockchain consensus mechanisms can cause catastrophic failures that lead to the loss of billions of dollars of economic value and data integrity regarding asset ownership. For example, the Ronin blockchain was hacked in 2022 for $625 million because of centralized points of failure and 51% attacks occur frequently and have significant and lasting negative effects on token prices (Shanaev et al., 2019). Since 2009, with blockchains growing rapidly and cryptocurrencies surpassing a 3.7 trillion-dollar market capitalization, and with institutions, including governments, increasingly tokenizing hundreds of billions of dollars of bonds and other assets on blockchains, understanding and sustaining decentralization is becoming increasingly critical.

This passage establishes both the downside risk (catastrophic failures when centralization occurs) and the growing economic stakes ($3.7 trillion market cap, government bonds on blockchains), directly addressing the SE's request for a clearer articulation of practical impact.

*Interesting.* We now make explicit why the question is intellectually interesting: the relationship between resource flexibility and decentralization is theoretically ambiguous, with compelling counterarguments showing that flexibility could *harm* rather than *help* decentralization:

> Section 2.2: However, the relationship between resource flexibility and sustained decentralization is theoretically ambiguous and cannot be assumed a priori. While the arguments above suggest flexibility should support decentralization, there are compelling counterarguments. First, resource flexibility could enable well-capitalized actors to rapidly scale their operations and dominate the network, thereby reducing decentralization. If flexible resources can be quickly acquired and deployed, large players with capital advantages may consolidate control faster than in systems with inflexible resources that constrain rapid expansion. Second, highly flexible resources might attract transient participants who enter during favorable conditions but exit quickly when conditions change, creating instability rather than sustained decentralization. Third, lowering barriers to entry through flexibility does not guarantee a more even distribution of power; it may simply allow more participants while concentration among top validators remains unchanged. These counterarguments underscore why the effect of resource flexibility on decentralization is an empirical question that cannot be resolved through theory alone.

That flexibility *sustains* decentralization--rather than enabling large-actor dominance, creating transient instability, or merely increasing participation without affecting power concentration--is a non-obvious empirical result. By presenting these counterarguments explicitly, the revised manuscript directly addresses the SE's concern that the question's intellectual interest was not established.

**2. Writing style.** We have systematically revised the writing throughout to replace journalistic framing with precise, theoretically grounded language. Below are representative before/after examples showing the shift:

*Before:* "A key question then is what are the tailwinds, if there are any, for sustained blockchain decentralization?"
*After:*

> Section 1: Decentralization faces countervailing economic forces, including economies of scale and coordination costs (Hui and Tucker, 2023). It also faces economic trade-offs with blockchain's other goals, such as net neutrality and permissionlessness (Halaburda and Obermeier, 2024; Bakos et al., 2021)... In short, decentralization cannot be taken for granted; it must be actively sustained against countervailing economic and technical forces.

We have also streamlined the introduction and theory sections to eliminate repetition. Content that previously appeared in both sections (e.g., the Ronin hack, 51% attacks, and countervailing economic forces) now appears only in the introduction, with the theory section focused on developing virtualization theory, resource flexibility, and testable predictions. Additionally, we revised language throughout to be more precise--for example, distinguishing "blockchain" from "blockchain network" and attributing market capitalization to cryptocurrencies rather than blockchains (see our response to Reviewer 1 for details).

**3. Theory-empirics linkage.** We have substantially tightened the connection between theory and empirics. Virtualization theory now serves three explicit roles: (a) motivating the construct of resource flexibility, (b) generating falsifiable predictions for each shock, and (c) providing the interpretive framework in each results section. We also connect resource flexibility to Williamson's (1985) asset specificity framework to ground the construct in economics (see our detailed response to the AE's "Role of theory" comment).

*Predictions.* We derive specific, directional, conditional predictions from virtualization theory for each shock:

> Section 2.2: Nevertheless, virtualization theory yields specific conditional predictions: if the flexibility mechanisms dominate the countervailing forces, we should observe particular patterns. For the China ban, we predict that Ethereum (GPU-based, more virtualized) should recover decentralization faster than Bitcoin (ASIC-based, less virtualized) because GPUs can be more easily relocated or redeployed to cloud infrastructure. For the Hetzner shutdown, we predict rapid recovery for Solana because staked tokens can be instantly transferred to validators on alternative infrastructure. For the Ethereum Merge, we predict increased decentralization because the transition to PoS lowers barriers to entry by eliminating hardware requirements. We test these predictions empirically and return to them when interpreting our results.

*Theory referenced in results.* Each results section now explicitly connects findings back to virtualization theory. For the China ban, the treatment effect persists after controlling for differential exposure, pointing to the role of virtualization characteristics:

> Section 4.1: The slight decrease in the effect size after controlling for exposure underscores the robustness of our findings, suggesting that the observed decline in Bitcoin's decentralization is not solely attributable to differences in exposure to the mining ban but also likely influenced by the underlying virtualization characteristics of the blockchain.

For the Hetzner shutdown, the recovery comparison between hardware-based Bitcoin and token-based Solana directly tests the flexibility mechanism:

> Section 4.2: Our results thus show that the flexibility of resources used in the consensus mechanism (i.e., tokens versus hardware) appears to have reduced frictions in recovering from shocks, suggesting a role in influencing sustained decentralization.

For the Ethereum Merge, the pattern of increased entropy and nodes alongside unchanged concentration metrics is consistent with the barrier-reduction mechanism:

> Section 4.3: This increase in entropy can be attributed to the addition of around 680 new nodes, direct evidence of the barrier-reduction mechanism predicted by virtualization theory. The accompanying increase in the Gini coefficient of 0.088 indicates that these new entrants are predominantly smaller validators, which increases measured inequality while improving overall decentralization through broader participation.

And in the discussion, we return to the theoretical framework:

> Section 5: These findings are consistent with virtualization theory (Section 2), which posits that abstracting computational processes from specific physical machines enables more flexible resource allocation and faster recovery from disruptions.

Crucially, the theory does not merely label results after the fact--it predicted the *gradient* before we observed it. The recovery timeline (>6 months for ASICs, minimal impact for GPUs, 43 days for tokens, permanent gain from PoW-to-PoS transition) maps monotonically onto the asset specificity continuum from Williamson (1985). This is the kind of theory-empirics linkage the SE requested: not post-hoc labeling but a theoretical framework that generates falsifiable predictions confirmed by the data and that would have been falsified by opposite patterns.

**4. Coherence of the three shocks.** We now explicitly articulate a measurement strategy that links all three shocks to resource flexibility. Because resource flexibility cannot be directly observed, we use the three shocks as complementary tests that vary the level of flexibility and the type of disruption. The introduction frames this upfront for the reader's first encounter:

> Section 1: China's ban shows the impact of resource flexibility (i.e., ASICs vs. GPUs) in response to a policy shock; Hetzner's shutdown contrasts with China's ban by revealing the impact of an even more flexible resource (i.e., tokens in PoS vs. hardware in PoW) in response to an infrastructure shock; and the Ethereum Merge assesses the effect of increased resource flexibility as Ethereum upgraded from PoW to PoS.

The methods section develops this strategy in detail, explaining how each shock maps to a specific level of resource flexibility:

> Section 3.1: Because resource flexibility cannot be directly measured, we leverage these quasi-experimental shocks to reveal differential impacts across systems with varying levels of flexibility. Specifically: (1) the China ban compares ASIC-based Bitcoin (inflexible, single-purpose hardware) to GPU-based Ethereum (flexible, general-purpose hardware) under the same policy shock; (2) the Hetzner shutdown tests token-based Solana (highly flexible, instantly transferable) under an infrastructure shock, which we compare to hardware-based recovery dynamics; and (3) the Ethereum Merge observes a single blockchain transitioning from less flexible (PoW hardware) to more flexible (PoS tokens) resources. This design allows us to infer the role of resource flexibility from observed differences in decentralization outcomes.

This triangulation strengthens identification: rather than relying on any single shock (each of which has specific limitations), the consistent pattern across the three shocks provides strongly suggestive evidence that resource flexibility plays a central role in the recovery and participation patterns we observe. Importantly, the cleanest evidence comes from within-shock comparisons (Bitcoin vs. Ethereum under the same China ban), while the cross-shock comparisons (China ban vs. Hetzner) provide additional supporting evidence despite differences in shock type and magnitude.

---

## 2. Associate Editor

### General Points

*Before delving into the substantive comments, I'll provide a few general points:*
- *The **manuscript is too long**. The submission guidelines indicate that papers should be **no longer than 38 pages**. My request would be to abide by these guidelines if you are to submit a revision.*
- *R1 points out that the authors could use **more precision in writing and defining the key concepts**. I agree, and this is incorporated (subtly or explicitly) into all of the reviews and needs work throughout the paper.*
- *You exploit three different shocks to answer your research question. I believe that it would enhance the story in the manuscript if you can **explain why these three different perspectives are important OR focus on one perspective**.*

Below we detail the changes for each point:

**Manuscript length.** We have reduced the manuscript to comply with the 38-page guideline. Specifically, we removed redundant content between the introduction and theory sections (e.g., the Ronin hack, 51% attacks, and countervailing economic forces were discussed in both; they now appear only in the introduction). We consolidated the resource flexibility definition so it is introduced briefly in the introduction and developed fully in the theory section. Supporting details have been moved to the Appendix.

**Precision in writing and concepts.** We have defined the three central concepts with explicit, stand-alone definitions:

- **Virtualization:** "the abstraction of physical computing resources, enabling them to be flexibly allocated and managed across different environments" (Section 2.2)
- **Decentralization:** "the distribution of decision-making authority and control across independent entities" (Section 2.1)
- **Resource flexibility:** "the ease with which participants can acquire, deploy, and redeploy the resources needed for consensus mechanisms across different locations and contexts" (Section 1)

We have also improved terminological precision throughout (e.g., distinguishing "blockchain" from "blockchain network," using "BTC market cap" instead of attributing market capitalization to blockchains), as detailed in our response to Reviewer 1.

**Three shocks.** We retain all three shocks because they provide complementary, triangulating evidence on resource flexibility across a spectrum from inflexible (ASICs) to moderately flexible (GPUs) to highly flexible (tokens). We now explain our measurement strategy explicitly:

> Section 3.1: Because resource flexibility cannot be directly measured, we leverage these quasi-experimental shocks to reveal differential impacts across systems with varying levels of flexibility. Specifically: (1) the China ban compares ASIC-based Bitcoin (inflexible, single-purpose hardware) to GPU-based Ethereum (flexible, general-purpose hardware) under the same policy shock; (2) the Hetzner shutdown tests token-based Solana (highly flexible, instantly transferable) under an infrastructure shock, which we compare to hardware-based recovery dynamics; and (3) the Ethereum Merge observes a single blockchain transitioning from less flexible (PoW hardware) to more flexible (PoS tokens) resources. This design allows us to infer the role of resource flexibility from observed differences in decentralization outcomes.

---

### Key Contribution

*The key contribution of this manuscript relies on the authors **(a) making the case that maintaining blockchain decentralization is a challenge** or at minimum not something that we can take for granted, **(b) making the argument that the relationship between resource flexibility and decentralization is somewhat unknown** (and important, this is where the theory comes in) and **(c) being able to accurately measure resource flexibility with the shocks**. Both my comments and the comments of the referees generally relate to how you can do (a), (b), and (c) better.*

We have strengthened all three components:

**(a) Decentralization cannot be taken for granted.** Our argument proceeds on three fronts. *First*, decentralization faces countervailing economic forces. Economies of scale favor large operators who can amortize fixed costs across more mining or validation activity; coordination costs create pressure toward centralization as networks grow. *Second*, decentralization faces trade-offs with other blockchain objectives. Design choices that enhance permissionlessness, neutrality, or efficiency may inadvertently reduce decentralization (Halaburda and Obermeier 2024; Bakos et al. 2021). *Third*, empirical evidence is mixed: Ju et al. (2025) find that several key subsystems of blockchain ecosystems are becoming more centralized over time, even as others remain stable or decentralize.

> Section 1: Decentralization faces countervailing economic forces, including economies of scale and coordination costs (Hui and Tucker, 2023). It also faces economic trade-offs with blockchain's other goals, such as net neutrality and permissionlessness (Halaburda and Obermeier, 2024; Bakos et al., 2021). Recent empirical work also estimates that several key subsystems of blockchain ecosystems are becoming more centralized (Ju et al., 2025). In short, decentralization cannot be taken for granted; it must be actively sustained against countervailing economic and technical forces.

The progression from economic forces to design trade-offs to empirical evidence means the argument does not rest on any single type of evidence. Even a reader skeptical of theoretical arguments about economies of scale must confront Ju et al.'s (2025) direct measurement of increasing centralization in blockchain subsystems.

**(b) The relationship between resource flexibility and decentralization is theoretically ambiguous.** We have added a new paragraph to the theory section that develops why this relationship cannot be assumed *a priori*. While virtualization theory suggests flexibility should support decentralization, we now present three counterarguments that make our empirical findings non-trivial:

1. *Large actor dominance:* Flexible resources could enable well-capitalized actors to rapidly scale and dominate, *reducing* decentralization.
2. *Transient participation:* Flexibility might attract participants who enter during favorable conditions but exit quickly, creating instability rather than sustained decentralization.
3. *Participation does not equal distribution:* Lower barriers may increase participants without affecting concentration among top validators.

> Section 2.2: However, the relationship between resource flexibility and sustained decentralization is theoretically ambiguous and cannot be assumed a priori. While the arguments above suggest flexibility should support decentralization, there are compelling counterarguments. First, resource flexibility could enable well-capitalized actors to rapidly scale their operations and dominate the network, thereby reducing decentralization... Second, highly flexible resources might attract transient participants who enter during favorable conditions but exit quickly when conditions change, creating instability rather than sustained decentralization. Third, lowering barriers to entry through flexibility does not guarantee a more even distribution of power... These counterarguments underscore why the effect of resource flexibility on decentralization is an empirical question that cannot be resolved through theory alone.

Nevertheless, virtualization theory yields specific *conditional* predictions: if the flexibility mechanisms dominate the countervailing forces, we should observe faster recovery and broader participation in more flexible systems. We derive these predictions below and test them empirically, allowing the evidence to discriminate between the competing theoretical forces.

**(c) Measuring resource flexibility with shocks.** Resource flexibility cannot be directly measured, so our identification strategy leverages quasi-experimental shocks to reveal differential impacts across systems with varying levels of flexibility. Each shock maps to a specific level of resource flexibility and provides a distinct test of the virtualization hypothesis.

> Section 3.1: Because resource flexibility cannot be directly measured, we leverage these quasi-experimental shocks to reveal differential impacts across systems with varying levels of flexibility. Specifically: (1) the China ban compares ASIC-based Bitcoin (inflexible, single-purpose hardware) to GPU-based Ethereum (flexible, general-purpose hardware) under the same policy shock; (2) the Hetzner shutdown tests token-based Solana (highly flexible, instantly transferable) under an infrastructure shock, which we compare to hardware-based recovery dynamics; and (3) the Ethereum Merge observes a single blockchain transitioning from less flexible (PoW hardware) to more flexible (PoS tokens) resources. This design allows us to infer the role of resource flexibility from observed differences in decentralization outcomes.

The strongest evidence for construct validity comes from the China ban, where the same shock affects two blockchains that differ primarily in hardware flexibility. The treatment effect on entropy moves from -0.209 to -0.198 after controlling for differential exposure--a reduction of only 5%--indicating that the vast majority of the differential response is not explained by differences in shock magnitude. The persistence of this effect through further controls (consensus covariates: -0.209; full covariates: -0.152) demonstrates that the measured difference reflects how each blockchain *recovered* from comparable proportional losses, not merely how much each lost. This recovery differential is precisely what resource flexibility predicts: ASICs cannot be redeployed, while GPUs can.

**Synthesis.** This three-part structure serves a substantive purpose--it is what makes the paper's findings discriminating rather than descriptive. Component (a) establishes that the outcome we study (sustained decentralization) is not automatic, so any observed pattern requires explanation. Component (b) generates competing predictions: if flexibility enables large-actor dominance, we should observe *faster* centralization in flexible systems; if flexibility creates transient instability, we should observe high variance but no sustained recovery. Component (c) then provides the empirical leverage to adjudicate among these predictions. The consistent gradient across three shocks--Bitcoin (ASICs, >6 months recovery) to Ethereum (GPUs, minimal decline) to Solana (tokens, 43-day recovery) to the Merge (permanent decentralization gain)--is uniquely consistent with the flexibility-sustains-decentralization prediction and inconsistent with the large-actor-dominance and transient-instability alternatives. Without this structure, the empirical patterns would be interesting correlations; with it, they become evidence that discriminates between competing theoretical mechanisms.

---

### What Are You Studying?

*(1) What are you studying? There is a **lack of clarity in how each piece of the paper relates to each other**... There is a **subtle difference between studying the impact of resource flexibility on decentralization and studying this in the presence of shocks**... Please spend time **clearly explaining the link between each of the shocks with resource flexibility**.*

We have revised the manuscript to make the link between each shock and resource flexibility explicit. We study how resource flexibility--operationalized through differences in consensus mechanism design--affects the ability of blockchain networks to sustain decentralization when subjected to exogenous shocks. The shocks are not the object of study per se; they are the identification strategy through which we observe resource flexibility in action. Resource flexibility is latent under normal operating conditions; it only becomes observable when a disruption forces participants to acquire, relocate, or redeploy resources. Shocks therefore function as the "stress tests" that reveal differences in flexibility that would otherwise remain hidden in equilibrium.

Each shock maps to a specific comparison along the resource flexibility spectrum:

- **China ban:** Same policy shock, different hardware. Compares ASIC-based Bitcoin (inflexible) to GPU-based Ethereum (flexible) under identical regulatory pressure.
- **Hetzner shutdown:** Infrastructure disruption to a token-based (highly flexible) system. Its value lies in contrasting the recovery dynamics with hardware-based recovery from the China ban.
- **Ethereum Merge:** Within-blockchain transition from less flexible (PoW hardware) to more flexible (PoS tokens) resources.

> Section 1: China's ban shows the impact of resource flexibility (i.e., ASICs vs. GPUs) in response to a policy shock; Hetzner's shutdown contrasts with China's ban by revealing the impact of an even more flexible resource (i.e., tokens in PoS vs. hardware in PoW) in response to an infrastructure shock; and the Ethereum Merge assesses the effect of increased resource flexibility as Ethereum upgraded from PoW to PoS.

We retain all three shocks because they triangulate the role of resource flexibility across different shock types and consensus mechanisms, providing more robust evidence than any single shock alone. However, we recognize that the China ban is our cleanest identification and have clarified the relative roles accordingly.

---

### Why Is This Important?

*(2) Why is this important? The authors **must do a better job up front of articulating why this is important**... The authors argue well why centralization is important, but **whether there is actually a threat to centralization is unclear**. In fact, the authors **seem to equate the existence of blockchain with centralization**.*

We do not equate blockchain with centralization. Our argument is that decentralization is the *design intent* of blockchains but that multiple forces work against this intent, making sustained decentralization an active challenge rather than an automatic outcome. The revised manuscript makes this case on three grounds.

*First*, decentralization is foundational to blockchain integrity. Without it, the core value propositions--fault tolerance, attack resistance, trustlessness--break down. The Ronin hack ($625 million lost from centralized points of failure) and frequent 51% attacks with lasting negative effects on token prices (Shanaev et al. 2019) demonstrate that the consequences are not hypothetical.

> Section 1: While too much decentralization can be bad for blockchain governance (Chen et al., 2021), failure to sustain decentralization in blockchain consensus mechanisms can cause catastrophic failures that lead to the loss of billions of dollars of economic value and data integrity regarding asset ownership. For example, the Ronin blockchain was hacked in 2022 for $625 million because of centralized points of failure and 51% attacks occur frequently and have significant and lasting negative effects on token prices (Shanaev et al., 2019).

The failure pattern is instructive: Ronin's centralized validator set was not a temporary lapse but a stable equilibrium that persisted until catastrophic exploitation. This suggests that centralization, once established, does not self-correct--an insight that motivates our focus on what *sustains* decentralization rather than what *initiates* it. The 51% attack evidence from Shanaev et al. (2019) further reveals that market participants price in centralization risk with lasting effects, meaning the economic consequences compound over time rather than resolving.

*Second*, decentralization faces documented threats. Economies of scale, coordination costs, and trade-offs with other design objectives create persistent pressure toward centralization. Ju et al. (2025) provide direct empirical evidence that several blockchain subsystems are becoming more centralized over time. This is not speculation--it is an observed trend.

*Third*, the stakes are growing:

> Section 1: Since 2009, with blockchains growing rapidly and cryptocurrencies surpassing a 3.7 trillion-dollar market capitalization, and with institutions, including governments, increasingly tokenizing hundreds of billions of dollars of bonds and other assets on blockchains, understanding and sustaining decentralization is becoming increasingly critical.

The shift from retail cryptocurrency speculation to institutional asset tokenization changes the failure mode: a centralization-induced exploit on a blockchain recording government bonds would implicate sovereign debt markets, not just speculative token holders. This is why the question has moved from niche to systemically important.

> Section 2.1: The underlying integrity of blockchains depends, in theory and in practice, on their decentralization. As discussed in the introduction, decentralization faces countervailing economic forces and cannot be taken for granted.

The theory section reinforces the introduction's framing by treating decentralization as a dependent variable that requires explanation, not an assumption baked into blockchain design.

We have also expanded the literature review (see response to Reviewer 1) and added Table 1, which provides a structured overview of key papers on blockchain decentralization to position our contribution within the cumulative literature.

> Section 1: Interestingly, our work complements that of Garratt and van Oordt (2023) who show that fixed costs in crypto mining increase resilience against 51% attacks when there are shocks to the price of crypto mining rewards... Our results show the flip side of resource flexibility: when there are shocks to the resources required for mining (versus the rewards from mining), it is harder for miners or validators to obtain or migrate the resources to keep mining.

This complementarity with Garratt and van Oordt (2023) underscores why our study is important: it reveals that the same design choice--resource specificity versus flexibility--has opposite implications depending on the threat vector. Blockchain designers therefore face a genuine tradeoff with no a priori dominant solution, which makes understanding the empirical consequences of resource flexibility a first-order design question for the Web3 economy.

---

### What Is the Role of the Theory?

*(3) What is the role of the theory? **The role of virtualization theory is unclear here**... If you continue to use virtualization theory, we should not only understand that virtualization increases resource flexibility, but **it should help explain the link between resource flexibility and the outcome**. That is, does the theory help explain *why* the ban in China would increase or decrease decentralization? Or *why* Hetzner's selective enforcement against Solana nodes would impact decentralization?*

We have substantially restructured the theory-empirics link so that virtualization theory explains *why* each shock would affect decentralization--not just that it does. The theory now identifies causal mechanisms, generates falsifiable predictions, and provides the interpretive framework for results.

**Two causal mechanisms.** Virtualization theory identifies two mechanisms through which resource flexibility should affect decentralization--the first explains why the China ban and Hetzner shutdown would differ by resource type; the second explains why the Merge would increase decentralization:

> Section 2.2: To understand the potential role of virtualization in blockchain decentralization, we examine two key contributions of virtualization to decentralization: 1) offering resource flexibility for rapid deployment and disaster recovery, and 2) democratizing participation by reducing barriers to entry. First, virtualization technologies facilitate flexible and rapid node deployment, which is critical for disaster recovery and operational resilience. Virtualization would theoretically allow blockchains to adapt and recover swiftly from disruptions, thereby promoting sustained decentralization. Second, by leveraging diverse computing resources and lowering participation costs, virtualization democratizes access to blockchain networks.

These mechanisms directly answer the AE's questions. For the China ban: *why* would it affect Bitcoin more than Ethereum? Because ASICs cannot be relocated or repurposed (Mechanism 1)--when Chinese miners lost access, ASIC miners could not rapidly redeploy, whereas GPU miners could leverage alternative computing infrastructure. For the Hetzner shutdown: *why* would Solana recover quickly? Because staked tokens can be instantly re-delegated (Mechanism 1, with even more flexible resources). For the Merge: *why* would PoS increase decentralization? Because eliminating hardware requirements lowers barriers to entry (Mechanism 2).

**Grounding in economics.** We connect resource flexibility to Williamson's (1985) asset specificity framework. Virtualization reduces asset specificity along the resource flexibility spectrum: ASICs are highly specific (single-purpose, high switching costs); GPUs are moderately specific (general-purpose but physical); staked tokens are non-specific (digital, instantly transferable). This gradient explains the mechanism: lower specificity means lower switching costs and faster redeployment. The discussion names this the *specificity-flexibility tradeoff*:

> Section 5.1: Moreover, the optimal level of resource flexibility may depend on the threat environment: as Garratt and van Oordt (2023) show, inflexibility can be protective when shocks target mining rewards, whereas our results demonstrate that flexibility is protective when shocks target the resources themselves.

This is a general economic principle: asset specificity protects against demand-side shocks (sunk costs create exit barriers), while asset flexibility protects against supply-side shocks (portable resources enable relocation).

**Falsifiable predictions.** We derive specific *conditional* predictions for each shock:

> Section 2.2: Nevertheless, virtualization theory yields specific conditional predictions: if the flexibility mechanisms dominate the countervailing forces, we should observe particular patterns. For the China ban, we predict that Ethereum (GPU-based, more virtualized) should recover decentralization faster than Bitcoin (ASIC-based, less virtualized) because GPUs can be more easily relocated or redeployed to cloud infrastructure. For the Hetzner shutdown, we predict rapid recovery for Solana because staked tokens can be instantly transferred to validators on alternative infrastructure. For the Ethereum Merge, we predict increased decentralization because the transition to PoS lowers barriers to entry by eliminating hardware requirements. We test these predictions empirically and return to them when interpreting our results.

These predictions are falsifiable: if the countervailing forces dominated (large-actor dominance, transient participation, unchanged power concentration), we would observe the opposite patterns.

**Evidence discriminates between mechanisms.** Each results section now connects findings back to virtualization theory. The results overview states the overall pattern:

> Section 4: As discussed in Section 2, virtualization theory predicts that more virtualized systems (those with greater resource flexibility) should recover more effectively from disruptions. Taken together, the dynamics of the shocks and the comparisons between the three shocks provide strongly suggestive evidence consistent with this prediction: virtualization plays a role in influencing blockchain decentralization.

For the China ban, the within-shock comparison provides the cleanest test of Mechanism 1--holding shock type and timing constant, only resource flexibility varies:

> Section 5.2: We observe that Ethereum experienced the same shock as Bitcoin, but that Ethereum, whose consensus mechanism was inherently more virtualized and thus more flexible, saw little to no negative effect on its decentralization.

For the Merge, the specific pattern across five metrics is uniquely consistent with Mechanism 2 (barrier reduction), not generic network improvement:

> Section 4.3: This pattern indicates that resource flexibility primarily operates at the extensive margin by broadening the base of participants rather than redistributing power among the largest validators. Affecting concentration at the intensive margin likely requires complementary mechanisms beyond resource flexibility alone.

This extensive-margin result is theoretically predicted: barrier reduction should first attract new, smaller participants before affecting concentration among existing large players--precisely the pattern the Merge data show (entropy and nodes up, Gini up, Nakamoto and HHI unchanged).

In sum, virtualization theory performs four distinct functions in our revised manuscript: it identifies two mechanisms (redeployment and barrier reduction), generates falsifiable predictions for each shock, explains the observed gradient across shocks, and predicts the nuanced extensive-margin pattern in the Merge. The theory tells us not just that flexibility matters, but *why* it matters differently across ASICs, GPUs, and tokens.

---

### Empirical Analysis

*(4) Empirical Analysis. **Is it important for the authors to use all three shocks?**... Measurement: R1 has comments about the **measurement of decentralization and whether participation is appropriate**... R2 has provided comments on the empirical analysis from the first shock (the China ban) and R3 has provided thorough comments on all three. These comments are comprehensive and so there is not much to add. I just want to emphasize that **addressing these comments are critical to the paper's future**.*

Here we summarize the key empirical revisions; full responses follow in the Reviewer 2 and Reviewer 3 sections.

**Three shocks.** We retain all three shocks because each isolates a different aspect of the resource flexibility spectrum: (1) the China ban directly compares two levels of hardware flexibility (ASICs vs. GPUs) under the same policy shock--our cleanest test; (2) the Hetzner shutdown demonstrates rapid recovery with highly flexible token-based resources, which we contrast with hardware-based recovery from the China ban; and (3) the Merge provides within-blockchain evidence of a transition from less to more flexible resources. Together, they triangulate the role of resource flexibility. The revised manuscript now clearly articulates this rationale upfront.

**Participation vs. decentralization.** We have clarified that we measure *distribution of power*, not merely participation. We employ five measures precisely because some capture participation (number of nodes) while others capture concentration (Gini, Nakamoto coefficient, HHI) and our primary measure, Shannon entropy (which captures both the number and evenness of participants), captures both simultaneously.

> Section 2.1: While higher participation can promote greater decentralization, decentralization is ultimately a question of how power and control are distributed. Thus, we use multiple measures of decentralization to capture meaningful shifts in the decentralization of the consensus layer, not participation alone.

Shannon entropy is our primary measure precisely because it is the only metric in our suite that simultaneously captures both dimensions--the number of participants *and* the evenness of their power distribution. A system with 1,000 nodes where three control 90% of block production would show high node count but low entropy. By leading with entropy and decomposing into component metrics, we can distinguish genuine decentralization from mere participation growth--a distinction the Merge results make vivid, where entropy rises but Gini also rises because new entrants are small.

**Empirical concerns from R2 and R3.** We have: (a) added exposure controls and covariate x treatment interactions to address confounders in the China ban analysis; (b) clarified that monthly fixed effects are already included; (c) provided robustness checks with blockchain-level clustering; (d) conducted finer-grained parallel trends tests at 10-day and 50-day intervals; (e) corrected standard error clustering in single-chain analyses; and (f) provided a detailed interpretation of the Gini coefficient increases. See our responses to R2 and R3 below.

The following table shows the China ban treatment effects are robust across specifications:

| Specification | Entropy | SE | Nodes | SE |
|---|---|---|---|---|
| **Baseline DiD** | -0.209\*\*\* | (0.048) | +5.050\*\*\* | (1.206) |
| **+ Exposure control** | -0.201\*\*\* | (0.047) | +4.943\*\*\* | (1.181) |
| **+ Consensus covariates** | -0.209\*\*\* | (0.049) | +5.050\*\*\* | (1.229) |
| **+ Covariates (full)** | -0.152\*\* | (0.048) | +0.134 | (1.112) |
| **+ Covariate x Treatment** | -0.022 | (0.013) | -0.203 | (0.319) |
| **Multi-period (After)** | -0.497\*\*\* | (0.063) | +1.219 | (1.575) |
| **Multi-period (During)** | -0.026 | (0.039) | +6.760\*\*\* | (1.669) |

Notes: \*p<0.05, \*\*p<0.01, \*\*\*p<0.001. Standard errors clustered by blockchain-month. All specifications include monthly fixed effects. "Consensus covariates" include hashrate, block size, number of transactions, token price, fee per transaction, and block reward. Multi-period specification separates the rolling enforcement period (May-July 2021) from the post-enforcement period (August 2021 onward).

The baseline treatment effect of -0.209 bits on entropy is robust: it persists after adding exposure controls (-0.201), consensus covariates (-0.209), and the full covariate set (-0.152). The attenuation with covariate-treatment interactions (-0.022) is theoretically expected, as these interactions absorb the very variation in blockchain characteristics--including resource flexibility--that drives the differential response. The multi-period specification reveals that the decentralization effect materialized after full enforcement (After: -0.497) rather than during the rolling ban (During: -0.026), consistent with the time required for physical hardware relocation--a pattern that itself supports the resource flexibility mechanism.

---

## 3. Reviewer 1

*Thank you for the opportunity to review this interesting paper. There are many things to like about it. It sensibly tackles a relevant problem and makes a stimulating read. However, some major issues need to be addressed.*

### 3.1 Contribution Clarity

*First, I have some concerns regarding the contribution you are trying to make. At times it is **not fully clear what contribution you are aiming for**... you write that your paper is "among the first to empirically demonstrate whether and how the consensus mechanism supports the promise of blockchain" (pages 5-6). **What are you referring to with the 'promise of blockchain'?** Decentralization?*

Yes--by "the promise of blockchain," we mean decentralization and the benefits it enables: fault tolerance, attack resistance, and trustlessness. We have revised this language to be explicit:

> Section 1: To the best of our knowledge, ours is the first study to empirically quantify the impact of consensus mechanism design on sustained blockchain decentralization and our work contributes to several areas of research... our paper is among the first to empirically demonstrate whether and how the consensus mechanism supports blockchain technology's promise of a decentralized network.

The shift from "the promise of blockchain" to "blockchain technology's promise of a decentralized network" eliminates the vagueness the reviewer identified. The contribution is now explicitly about sustained decentralization--not about blockchain's general value proposition.

---

### 3.2 Importance of Decentralization

*Further, you might want to **make a more compelling case that more decentralization is better**. I raise this because some research suggests that there can be **too much decentralization** (Chen et al. 2021). To strengthen your argument on the importance of decentralization, you could further **discuss the research studying the consequences of (de-)centralization**. To help you make this case, the paper by Shanaev et al. (2019) might be useful.*

We agree that the relationship between decentralization and outcomes is not monotonic, and we now explicitly acknowledge this. Chen et al. (2021) demonstrate that too much decentralization can harm governance, and we cite this. However, our argument is not that maximum decentralization is always optimal--it is that *sustained* decentralization in consensus mechanisms is critical for the core value propositions of blockchains (resistance to attacks, faults, and collusion). When decentralization fails, the consequences are catastrophic:

> Section 1: While too much decentralization can be bad for blockchain governance (Chen et al., 2021), failure to sustain decentralization in blockchain consensus mechanisms can cause catastrophic failures that lead to the loss of billions of dollars of economic value and data integrity regarding asset ownership. For example, the Ronin blockchain was hacked in 2022 for $625 million because of centralized points of failure and 51% attacks occur frequently and have significant and lasting negative effects on token prices (Shanaev et al., 2019).

Both references are now integrated into the introduction.

---

### 3.3 Literature Review

*Overall, I worry that the **literature review is not thorough enough**. Garratt and van Oordt's (2023) paper also studied the impact of resource flexibility (even if they do not explicitly call it that)... I think it is **essential you engage with this paper more**... it might be a good idea to provide a **structured overview of key papers** that study antecedents of decentralization.*

We have significantly expanded our engagement with the literature.

**Garratt and van Oordt (2023).** This paper is now a key reference in our introduction. Their work and ours reveal what we term the *specificity-flexibility tradeoff* in consensus mechanism design: asset specificity protects against demand-side shocks--when mining reward prices fall, sunk costs in specialized hardware create exit barriers that prevent miners from leaving, thereby maintaining network security. Our results demonstrate the complementary force: asset flexibility protects against supply-side shocks--when the resources themselves are disrupted, portable and redeployable assets enable participants to relocate and continue operating, thereby maintaining decentralization. The optimal consensus mechanism design may therefore depend on the threat environment a blockchain faces.

> Section 1: Interestingly, our work complements that of Garratt and van Oordt (2023) who show that fixed costs in crypto mining increase resilience against 51% attacks when there are shocks to the price of crypto mining rewards. They argue fixed costs make it harder for miners to switch their hardware, or other resources, to other uses when mining rewards drop in price, thus improving resilience against attacks. Our results show the flip side of resource flexibility: when there are shocks to the resources required for mining (versus the rewards from mining), it is harder for miners or validators to obtain or migrate the resources to keep mining.

**Literature table.** We have added Table 1, which provides a structured overview of key studies on blockchain decentralization, including their methodological approaches, main findings, and boundary conditions.

> Section 1: Table 1 provides an overview of key studies on blockchain decentralization and positions our contribution within this literature.

| **Study** | **Approach** | **Main Finding** | **Boundary Conditions** |
|---|---|---|---|
| Gencer et al. (2018) | Empirical measurement | Bitcoin and Ethereum networks are not as decentralized as assumed; mining pools dominate | Snapshot analysis; limited time period |
| Cong et al. (2021) | Theoretical model | Decentralized consensus can emerge despite economies of scale through appropriate mechanism design | Model assumptions; permissionless setting |
| Cong et al. (2022) | Causal identification | Layer-2 scaling increases decentralization in oracle data providers | Oracle subsystem only; not consensus layer |
| Capponi et al. (2023) | Theoretical model | Mining technology (ASICs vs. GPUs) affects decentralization through economies of scale | PoW blockchains only |
| Garratt & van Oordt (2023) | Theoretical model | Fixed costs in mining increase resilience to 51% attacks when reward prices drop | Shocks to rewards, not resources |
| Mueller-Bloch et al. (2024) | Agent-based simulation | Higher participation promotes decentralization in PoS; wealth concentration is a risk | Simulation; PoS only |
| Chen et al. (2021) | Empirical (blockchain platforms) | Inverted U-shaped relationship: semi-decentralization outperforms full decentralization | Platform governance, not consensus |
| Sai et al. (2021) | Taxonomy/Framework | Identifies multiple dimensions of decentralization across blockchain subsystems | Descriptive; no causal claims |
| Ju et al. (2025) | Longitudinal empirical | Crypto ecosystems show mixed trends; recent centralization in consensus, NFTs, developers | Measurement focus; limited causal identification |
| **This paper** | **Quasi-experimental** | **Resource flexibility of consensus mechanisms enables sustained decentralization** | **Three specific shocks; limited blockchains** |

**Table 1: Key Studies on Blockchain Decentralization.** The boundary conditions column makes visible that no prior study has used quasi-experimental methods to test how consensus mechanism design affects sustained decentralization--the gap our paper fills.

---

### 3.4 Conceptual Foundations

*Regarding the conceptual foundations of your paper, I believe there is room for improvement. As two concepts essential to your study, it would be appropriate to **provide definitions of virtualization and decentralization**... Defining decentralization is particularly crucial since **organizational scholars, who also make up part of the readership of ISR, define decentralization (and distribution) differently** from how computer scientists and economists would (Vergne 2020).*

We have provided explicit definitions for both concepts.

**Virtualization:**

> Section 2.2: Technical virtualization refers to the abstraction of physical computing resources, enabling them to be flexibly allocated and managed across different environments. Rather than eliminating the need for hardware, virtualization enhances its flexibility by decoupling computational processes from specific physical machines.

We have also clarified that the contrast is not between virtualization and hardware per se, but between *flexible* resources (e.g., GPUs, cloud computing, staked tokens) and *inflexible* resources (e.g., specialized ASICs that cannot be repurposed). In economic terms, this corresponds to a gradient of asset specificity (Williamson, 1985): from highly specialized, location-bound physical capital to general-purpose, location-independent digital assets.

**Decentralization:**

> Section 2.1: We define decentralization as the distribution of decision-making authority and control across independent entities. In organizational theory, this emphasizes communication and coordination dispersion, while in computer science and economics, it often refers to how control over infrastructure and governance is spread.

We cite Vergne (2020) and acknowledge the disciplinary differences in defining decentralization. Our operationalization through multiple measures (entropy, Gini, Nakamoto, HHI) captures the distribution of control in consensus mechanisms, which aligns with both perspectives.

---

### 3.5 Hypothesis Development

*Regarding the hypothesis development, I think you might want to offer stronger rationales. In particular, I think it is crucial to keep in mind that **participation and decentralization are not the same**. While there is some evidence that blockchain networks with high degrees of participation tend to be more decentralized (Mueller-Bloch et al. 2024), even a **blockchain network with thousands of nodes can in theory be centralized** since power among the nodes does not have to be evenly distributed.*

We fully agree that participation and decentralization are not equivalent--a network with many nodes can still be centralized if power is concentrated among a few. This is precisely why we employ *multiple* measures that capture both participation (number of nodes) and the *distribution* of power (Shannon entropy, Gini, Nakamoto, HHI). Shannon entropy, our primary measure, is sensitive to both the number of participants *and* the evenness of their power distribution, making it a holistic measure of decentralization.

> Section 2.1: While higher participation can promote greater decentralization (Mueller-Bloch et al., 2024), decentralization is ultimately a question of how power and control are distributed. Thus, we use multiple measures of decentralization to capture meaningful shifts in the decentralization of the consensus layer, not participation alone.

The Merge results provide the clearest illustration of this distinction: entropy and node count both increased (more participants), but Gini also increased (new entrants were smaller than incumbents) while Nakamoto and HHI remained unchanged (the top of the distribution was unaffected). This decomposition shows that our measures can separate participation from power distribution, and that resource flexibility's primary channel is at the extensive margin--lowering barriers to entry--rather than redistributing power among incumbents.

---

### 3.6 Measurement of Decentralization

*I also have some questions regarding how you measure decentralization. **How did you account for whether a node belongs to a mining pool?** Were you able to identify which nodes belong to a mining pool (and if yes, which mining pool) and which do not? If yes, how? **Were some nodes anonymous?** If yes, how did you deal with that data?*

**Mining pools in Bitcoin.** We account for mining pools by using the coinbase transaction (the first transaction in each block that distributes mining rewards), which distributes rewards proportionally among pool participants based on their contributed computational power:

> Section 3.2: For Bitcoin, we divided the attribution of the block proportionally among the recipients of the block reward to account for mining pools that distribute rewards in the coinbase transaction; for all others, we attributed each block to a single node.

> Section 3.2, footnote: The coinbase transaction is the first transaction in a block on a blockchain network such as Bitcoin... In the context of mining pools, the coinbase transaction distributes these rewards proportionally among all pool participants, based on their contributed computational power.

**Ethereum validators post-Merge.** For Ethereum after the Merge, we correct for proposer-builder separation (PBS, a mechanism where block building and block proposing are done by different entities), identifying the actual validator (proposer) rather than the block builder who receives rewards first. This methodology is detailed in the Appendix.

**Anonymous nodes.** Blockchain pseudonymity prevents perfect identification. Our approach captures the distribution of block production across distinct addresses, which provides an upper bound on decentralization (actual decentralization is less than or equal to measured decentralization due to the possibility that one entity controls multiple addresses). We discuss Sybil attack limitations in the Limitations section and note that our treatment effect estimates are unlikely to be affected by Sybil vulnerabilities since these should be constant across pre- and post-treatment periods and across treatment and control blockchains.

---

### 3.7 Language Precision

*I encourage you to **use language more precisely**. The blockchain is "just" the ledger of transactions. Hence, it would be appropriate to **distinguish between the blockchain and the blockchain network**...*

We agree that this distinction is valuable. We have revised the manuscript to use "blockchain network" where we refer to the system of nodes and consensus mechanisms, while reserving "blockchain" for references to the ledger. For example, we now write:

> Abstract: We hypothesize that the resource flexibility of consensus mechanisms is a key enabler of the sustained decentralization of blockchain networks.

We have also corrected market capitalization references to properly attribute them to cryptocurrencies (e.g., "BTC market cap" and "ETH market cap" rather than attributing market capitalization to blockchains):

> Section 3.1: Bitcoin online since January 2009 (BTC market cap of over $809 billion) and Ethereum online since July 2015 (ETH market cap of $349 billion).

We acknowledge that some uses of "blockchain" as shorthand remain where the meaning is clear from context, consistent with common usage in the literature (Gencer et al. 2018; Cong et al. 2021).

---

## 4. Reviewer 2

*This paper explores the factors that enable or constrain blockchain decentralization, hypothesizing that resource flexibility is key enabler. It studies three quasi-experiments... The paper addresses an important question regarding the drivers of blockchain decentralization. The setup and analysis are generally clear, but the **paper's scope--covering three different shocks--dilutes the depth** of each case study. The authors might consider **concentrating on and delving deeper into the China ban**, as the other two case studies do not as effectively address the question of interest. Specifically, **Hetzner's targeted ban on Solana validators...does not directly address the role of resource flexibility**. To effectively study this, one would ideally need to examine the effects on **different blockchains with varying degrees of resource flexibility when subjected to similar restrictions**. Regarding the Ethereum Merge, the protocol change aimed to make the blockchain faster, more secure, and more resource-efficient. It is **not clear why changes in participation should be attributed to resource flexibility rather than these other factors**.*

The concern about scope versus depth is well taken, and the recommendation to focus on the China ban aligns with our own assessment. We agree that the China ban provides our cleanest identification (it is an exogenous policy shock affecting two PoW blockchains simultaneously, with measurable differential exposure enabling DiD estimation with exposure controls) and constitutes the core of our empirical contribution; the Hetzner and Merge analyses serve as complementary evidence that strengthens the overall case through triangulation across the resource flexibility spectrum. We retain all three shocks, but we want to address the specific critiques about Hetzner and the Merge, which we believe can be substantially resolved.

**Hetzner and resource flexibility.** The reviewer correctly notes that the Hetzner shutdown alone does not isolate resource flexibility--it is a single-blockchain shock. We agree, and the revised manuscript now explicitly frames its value as lying in the comparison with the China ban:

> Section 4.2: While this analysis examines a single blockchain rather than comparing across resource flexibility levels, its value lies in the comparison with the China ban: both represent "forced relocation" shocks where consensus participants were suddenly unable to operate from their existing infrastructure. Comparing recovery dynamics across these shocks (hardware-based Bitcoin versus token-based Solana) reveals how resource flexibility affects resilience.

The key difference is in the resources involved: Bitcoin miners had to physically relocate specialized hardware (ASICs) to new jurisdictions--requiring shipping, new facilities, and new power contracts. Solana validators needed to re-establish operations on alternative cloud providers, and critically, staked tokens (SOL) could be instantly re-delegated via a blockchain transaction. The data bear this out: Bitcoin's decentralization took over 6 months to recover, while Solana recovered in approximately 43 days.

The revised manuscript also addresses the natural concern that this recovery difference could reflect shock magnitude rather than resource flexibility:

> Section 4.2: The two shocks also differed in magnitude: Hetzner's shutdown affected approximately 20% of Solana's staked validators, while China's ban displaced roughly 75% of Bitcoin's hashrate. While this severity difference contributes to the difference in recovery timelines, it cannot account for the within-shock comparison: under the same China ban, Ethereum (with more flexible GPUs) experienced minimal decline while Bitcoin (with inflexible ASICs) suffered lasting decentralization loss.

This within-shock comparison is the critical evidence: it holds shock type and timing constant, isolating resource flexibility as the key difference.

To be explicit: while the Hetzner shutdown alone is not a clean test of resource flexibility (it is a single-blockchain shock without a same-shock comparison group), the *pattern across all three shocks* constitutes our identification strategy. In each case, more flexible resources are associated with faster and more complete recovery of decentralization--from ASICs (slowest recovery) to GPUs (minimal decline) to tokens (fastest recovery). It is this consistent gradient, not any single shock in isolation, that provides the evidential basis for our resource flexibility hypothesis.

**Ethereum Merge and resource flexibility.** The reviewer correctly notes that the Merge aimed to improve speed, security, and efficiency alongside changing the consensus mechanism. However, none of these improvements *mechanically predict* increased decentralization. In fact, efficiency gains often favor large operators through economies of scale, potentially *reducing* decentralization. The resource flexibility mechanism is distinct: by replacing hardware requirements (expensive GPUs, cheap electricity, technical expertise) with token requirements (32 ETH and consumer-grade hardware), the Merge directly lowered barriers to entry--the second mechanism through which virtualization theory predicts increased decentralization. We now state this explicitly in the manuscript:

> Section 4.3: Importantly, while the Merge also improved Ethereum's speed, security, and energy efficiency, these improvements do not mechanically predict increased decentralization. Efficiency gains often favor large operators through economies of scale, potentially reducing decentralization. The resource flexibility mechanism is distinct: by replacing hardware requirements (e.g., expensive GPUs, cheap electricity, technical expertise) with token requirements (i.e., 32 ETH and consumer-grade hardware), the Merge directly lowered barriers to entry, the second mechanism through which virtualization theory predicts increased decentralization.

The empirical evidence supports this interpretation:

> Section 4.3: This increase in entropy can be attributed to the addition of around 680 new nodes, direct evidence of the barrier-reduction mechanism predicted by virtualization theory. The accompanying increase in the Gini coefficient of 0.088 indicates that these new entrants are predominantly smaller validators, which increases measured inequality while improving overall decentralization through broader participation.

The pattern across five metrics--entropy and nodes up, Gini up, Nakamoto and HHI unchanged--fits barrier reduction and rules out the alternatives: efficiency-driven consolidation would decrease entropy and nodes while lowering Gini, and generic ecosystem growth would increase nodes without changing Gini.

Concurrent changes in the Ethereum ecosystem--such as the EIP-1559 fee mechanism (implemented in August 2021, over a year before the Merge) and fluctuations in DeFi and NFT activity--are unlikely to drive our results. Our event study design compares Ethereum to itself before and after the Merge, so any confounder would need to change discontinuously at the Merge date. The five-metric decomposition provides additional diagnostic power: generic ecosystem growth would increase nodes and entropy without changing Gini, while fee-structure changes would alter concentration metrics without necessarily adding new participants. Only the barrier-reduction mechanism predicts the specific pattern of more participants who are predominantly smaller, which is what the data show.

---

### 4.1 Confounders

*1a. The differential impact on Bitcoin versus Ethereum **might reflect the higher pre-ban concentration of mining in China** for Bitcoin (~75% vs. ~25% for Ethereum).*

*1b. The authors should **interact these confounders** (taking the pre-experiment average) **with the treatment dummy**...*

*1c. The authors should also consider **controlling for the difference in characteristics in the application layer**.*

**1a. Pre-ban concentration.** The reviewer identifies the central identification concern. The differential concentration is precisely what our Exposure variable measures: we estimate the hashrate drawdown following the ban and find Exposure_Bitcoin = 0.511 and Exposure_Ethereum = 0.258, reflecting the ~75% vs. ~25% China concentration.

The critical finding is that our treatment effect *persists after controlling for exposure*. If the effect were purely mechanical--simply reflecting that Bitcoin lost more hashrate--controlling for exposure should eliminate it. Instead, the treatment coefficient decreases only slightly from -0.209 to -0.198, while the exposure term shows a small but significant effect of -0.044. This indicates that *how each blockchain recovered* from the loss differed systematically, conditional on the same proportional shock--consistent with our resource flexibility hypothesis.

> Section 3.2: Non-random exposure to exogenous shocks can bias estimates... We find that Exposure_Bitcoin = 0.511 and Exposure_Ethereum = 0.258, and we use these estimates as control and treatment exposure covariates. These exposure measures reflect the differential concentration of mining in China before the ban--approximately 75% of Bitcoin hashrate versus 25% of Ethereum hashrate was estimated to be in China. By controlling for this differential exposure, our identification strategy isolates how each blockchain recovered from similar proportional shocks, which we attribute to differences in resource flexibility.

**1b. Interacted confounders.** We have added robustness checks with consensus layer covariates (hashrate, transaction fees, number of transactions) interacted with the treatment dummy. Our treatment effects remain qualitatively similar.

> Appendix A.1: In our robustness check, we find that our overall results are robust to these covariates with and without interactions with the treatment variable.

**1c. Application layer differences.** While Bitcoin and Ethereum differ substantially in their application ecosystems, the consensus layer is agnostic to the application layer. At the time of the ban, both blockchains used PoW for consensus, and the economic incentive structure for block production was equivalent apart from the different hash functions and required mining hardware:

> Section 3.1: While Bitcoin and Ethereum differ in their applications, the consensus layer is agnostic to the application layer; thus, the economic incentive structure is equivalent for both blockchains apart from the different hash functions and required mining hardware.

Moreover, if miners' expectations about the ban's effects on each blockchain's *popularity* were driving the differential response, we would expect to see differential price effects. We find that Bitcoin's price barely changed around the ban (-$1,288 from $49,350, p = 0.378), ruling out the hypothesis that miners differentially fled Bitcoin due to anticipated application-layer damage.

---

### 4.2 Time Fixed Effects

*2. The empirical model could be improved by **including time dummies (weekly or monthly)** to account for temporal confounders.*

Our main specification already includes monthly fixed effects. The table note for the China ban results states this directly:

> Section 4.1, Table 3 notes: Standard errors are clustered by blockchain and month, as clustering at the blockchain level alone yields only 2 clusters, which is insufficient for reliable asymptotic inference (Cameron et al. 2008; MacKinnon et al. 2023). See Appendix for a robustness check with blockchain-level clustering. Monthly fixed effects (FE) are included.

These monthly fixed effects absorb common temporal shocks that affect both Bitcoin and Ethereum equally--broader cryptocurrency market trends, macroeconomic conditions, or regulatory announcements affecting the entire industry. The treatment effect is therefore identified only from the *differential* change between Bitcoin and Ethereum within each month, net of any shared time trend.

---

### 4.3 Clustered Standard Errors

*3. The **level of clustering should match the level of treatment assignment**, which is at the blockchain level.*

We agree in principle. However, clustering at the blockchain level yields only 2 clusters (Bitcoin and Ethereum). Clustered standard errors rely on asymptotic properties that require a sufficient number of clusters, with econometric guidance typically recommending 30-50 or more (Cameron et al. 2008; MacKinnon et al. 2023). With only 2 clusters, standard errors are likely to be severely downward-biased. The revised table note now states this justification explicitly:

> Section 4.1, Table 3 notes: Standard errors are clustered by blockchain and month, as clustering at the blockchain level alone yields only 2 clusters, which is insufficient for reliable asymptotic inference (Cameron et al. 2008; MacKinnon et al. 2023). See Appendix for a robustness check with blockchain-level clustering. Monthly fixed effects (FE) are included.

Our approach of clustering at the blockchain-month level provides approximately 40 clusters (2 blockchains x 20 months), which offers more reliable inference while still accounting for within-unit correlation at a meaningful temporal granularity. This approach is consistent with panel data practices when the number of cross-sectional units is small (Petersen 2009).

To directly address the concern, we have added a robustness check in the Appendix:

> Appendix, Clustering at the blockchain level: As a robustness check, we demonstrate that clustering only at the blockchain level, not the blockchain-month level, results in unrealistically low standard errors, which would lead to overconfident statistical significance (Cameron et al. 2008; Petersen 2009).

The treatment effects remain qualitatively similar and statistically significant with blockchain-level clustering, though we note the inference should be interpreted with caution given the few-cluster problem.

---

### 4.4 Parallel Trends

*4. The testing for parallel trends using **60-day intervals...may be too coarse**.*

We have added finer-grained parallel trends analyses. In the original 60-day intervals, the one statistically significant pre-treatment coefficient (at tau=-120) is *positive* (+0.082 bits), meaning Bitcoin was *more* decentralized relative to Ethereum 120 days before the ban--the opposite direction of our treatment effect. The coefficients at tau=-60 and tau=-180 are both small and insignificant. This pattern is reassuring: there is no pre-trend toward Bitcoin becoming less decentralized, and the significant coefficient works against our finding, making our estimate conservative.

We now also present finer-grained analyses in the Appendix:

> Appendix: We also conduct lagged analyses with a finer timescale of 50 days.

These 50-day intervals provide more granular evidence, with pre-treatment coefficients small and centered around zero. Additionally, the 10-day intervals in Figure 5 (the lag comparison figure) show no systematic pre-treatment divergence for the China ban. The visual evidence in Figure 3 further corroborates closely parallel trends before the ban. Taken together, the finer-grained tests at multiple timescales consistently support the parallel trends assumption.

---

## 5. Reviewer 3

*Thank you for submitting your manuscript to Information Systems Research. This work was well-motivated... Overall, this is a well-written research paper on a critically important, highly relevant, timely, but empirically under-studied topic.*

### 5.1 Major Issue 1: Resource Flexibility

*The current definition of resource flexibility ("... avoiding operational disruptions," p. 8) appears to have already captured the intended objective of maintaining decentralization... **the hypothesis, in its current form, sounds tautological**.*

*In this paper, **resource flexibility is not directly measured but proxied** by differences across blockchains, shocks, and before and after a technical upgrade... **caution is needed when using terms like "the effect/impact of resource flexibility."***

*Further, there are concerns about the **face/construct validity of resource flexibility**. For example, Solana nodes consume extensive computing resources compared to nodes in other blockchains, thereby being resource inefficient. However, **resource efficiency is not equivalent to resource flexibility**.*

*Relatedly, the nature of virtualization (and its interplay with resource flexibility) in blockchains needs further exposition. For example, **why is Ethereum more virtualized (in terms of what) than Bitcoin?***

We address each concern:

**Tautology.** We have revised the definition to focus on *input capability* rather than the outcome:

> Section 2.2: We define resource flexibility as the ease with which participants can acquire, deploy, and redeploy the resources required for consensus across different locations and operational contexts.

The revised text now explicitly frames the relationship as an open empirical question rather than assuming the answer:

> Section 2.2: Whether this flexibility translates into sustained decentralization is an empirical question--one that we test using quasi-experimental variation across blockchains with different levels of resource flexibility.

More importantly, the hypothesis is *not* tautological because the relationship between resource flexibility and sustained decentralization is theoretically ambiguous. We now present three counterarguments for why resource flexibility might *harm* decentralization: (1) it could enable large actors to dominate faster, (2) it could attract transient participants who create instability, and (3) lower barriers do not guarantee more even power distribution. Our finding that flexibility sustains decentralization--rather than enabling centralization or creating instability--is therefore a substantive, non-obvious empirical result.

**Proxy measurement.** The revised manuscript explicitly flags the proxy nature of our measurement:

> Section 1: We leverage quasi-experimental variation across six blockchains (i.e., Bitcoin, Ethereum, Solana, Gnosis, BNB, Ronin) to investigate how resource flexibility, proxied by differences in blockchain designs, influences blockchain decentralization.

We use language like "proxied by" and "suggestive evidence" throughout, and we discuss in the Limitations section that our natural experiments cannot vary *only* resource flexibility.

**Resource efficiency vs. flexibility.** We now explicitly distinguish these concepts:

> Section 2.2: This flexibility is distinct from resource efficiency: while some blockchains may require higher computational resources, their ability to reallocate these resources in response to shocks is what determines their flexibility, not their absolute efficiency.

Solana consumes extensive computing resources (resource *inefficient*), but its PoS token-based consensus makes those resources highly *flexible*--validators can instantly re-delegate tokens to alternative infrastructure, as demonstrated by the 43-day recovery from the Hetzner shutdown.

**Why Ethereum is more virtualized than Bitcoin.** The distinction lies in the hardware required for consensus. Bitcoin uses application-specific integrated circuits (ASICs)--specialized chips that can *only* perform Bitcoin mining and cannot be repurposed. Ethereum used general-purpose GPUs, which can be redeployed across different computational tasks including cloud-based infrastructure. In terms of asset specificity (Williamson, 1985), ASICs are highly specific (single-purpose, high switching costs), while GPUs are moderately specific (general-purpose but still physical). After the Merge, Ethereum became even more virtualized by replacing hardware entirely with staked tokens--non-specific digital assets:

> Section 3.2: Bitcoin is still PoW and uses specialized hardware (i.e., application-specific integrated circuits ASICs) and energy-intensive computations to achieve consensus. Ethereum relied on PoW until September 15, 2022, when it was upgraded to PoS... Because ASICs are highly specialized and physically constrained to a single function, they limit adaptability in response to disruptions. In contrast, GPUs are more general-purpose, allowing for greater virtualization; miners could reallocate their computational power dynamically, including leveraging cloud-based resources.

**Virtualization referenced in results.** We now explicitly connect findings to virtualization theory throughout the results:

> Section 4: As discussed in Section 2, virtualization theory predicts that more virtualized systems (those with greater resource flexibility) should recover more effectively from disruptions. Taken together, the dynamics of the shocks and the comparisons between the three shocks provide strongly suggestive evidence consistent with this prediction.

And in the discussion:

> Section 5: These findings are consistent with virtualization theory (Section 2), which posits that abstracting computational processes from specific physical machines enables more flexible resource allocation and faster recovery from disruptions.

---

### 5.2 Major Issue 2: Empirical Analysis Concerns

*The analyses of all three quasi-experiments **rely heavily on time-related variations and much less on cross-chain variations**... the analysis of the first quasi-experiment was based on a panel dataset of **only 2 cross-sectional units** (Bitcoin as the treatment unit and Ethereum as the control unit) over 601 days... **I have never seen DiD research before using only one treatment unit and one control unit** for causal inference.*

The China ban provides a population-level natural experiment covering the two major PoW blockchains that existed at the time. This is not a sampling limitation but a feature of the empirical setting: every major PoW chain was affected, and our DiD exploits the full variation in resource flexibility between them. The 2-unit structure is unusual in applied microeconomics, but comparative case studies with very few units have a long history when the treatment setting is inherently small-N (e.g., Abadie et al. 2010's synthetic control method was developed precisely for single-treated-unit settings).

The revised manuscript now frames the identification strategy explicitly:

> Section 3.1: Because resource flexibility cannot be directly measured, we leverage these quasi-experimental shocks to reveal differential impacts across systems with varying levels of flexibility. Specifically: (1) the China ban compares ASIC-based Bitcoin (inflexible, single-purpose hardware) to GPU-based Ethereum (flexible, general-purpose hardware) under the same policy shock; (2) the Hetzner shutdown tests token-based Solana (highly flexible, instantly transferable) under an infrastructure shock, which we compare to hardware-based recovery dynamics; and (3) the Ethereum Merge observes a single blockchain transitioning from less flexible (PoW hardware) to more flexible (PoS tokens) resources. This design allows us to infer the role of resource flexibility from observed differences in decentralization outcomes.

The identification does not rely solely on cross-sectional variation. The treatment effect is identified from the *interaction* of the cross-sectional difference (Bitcoin vs. Ethereum) with the temporal change (pre- vs. post-ban). The Exposure variable controls for differential shock magnitude, and monthly fixed effects absorb common temporal trends. The robustness of the treatment effect through successive controls is itself informative:

> Section 4.1: The slight decrease in the effect size after controlling for exposure underscores the robustness of our findings, suggesting that the observed decline in Bitcoin's decentralization is not solely attributable to differences in exposure to the mining ban but also likely influenced by the underlying virtualization characteristics of the blockchain.

The 5% attenuation from -0.209 to -0.198 after adding exposure controls means that differential shock magnitude explains very little of the treatment effect. What remains is how each blockchain *recovered*--which is precisely the resource flexibility channel.

We further mitigate time-varying confounder concerns through several robustness checks: (a) consensus layer covariates (hashrate, transaction fees, transactions) with and without treatment interactions, (b) multi-period DiD estimation (Callaway and Sant'Anna 2021), (c) geographic hashrate validation using Cambridge data, and (d) price analysis ruling out differential market sentiment effects.

> Appendix A.1: In our robustness check, we find that our overall results are robust to these covariates with and without interactions with the treatment variable.

**Control group selection (Hetzner).** We have revised the manuscript to accurately describe the donor pool. The previous description of "four other Proof-of-Stake blockchains" was imprecise: Gnosis used PoA before transitioning to PoS in December 2022 (near the end of our analysis window), and Ronin used PoA throughout. We now describe these chains accurately and justify their inclusion:

> Section 3.3: This control is constructed as a weighted sum of the entropy values from four other blockchains: Ethereum, Gnosis, BNB, and Ronin. While these blockchains vary in their consensus mechanisms during the analysis period (Ethereum had recently transitioned to PoS, Gnosis used PoA before transitioning to PoS in December 2022, and BNB and Ronin used delegated or authority-based validation), all represent alternative blockchain networks that were not affected by the Hetzner shutdown and thus serve as plausible counterfactuals for Solana's trajectory. The synthetic DiD method assigns weights to donor units based on pre-treatment fit, so chains that poorly match Solana's pre-treatment dynamics receive low weight, mitigating concerns about donor pool composition. The estimated weights are Gnosis (0.284), Ronin (0.282), BNB (0.280), and Ethereum (0.154), indicating that the four donor chains contribute roughly equally to the synthetic control.

Regarding the suggestion to include only permissionless blockchains (Ethereum and Gnosis): this would reduce our donor pool to just 2 chains, limiting the synthetic control's ability to match Solana's pre-treatment trajectory. We note that the permissioned/permissionless distinction is most relevant for participation *levels* but less so for *trends* in decentralization, which is what the synthetic control matches on.

**Bitcoin as control for the Merge.** Bitcoin continued using PoW while Ethereum transitioned to PoS, which might seem like a natural control. However, Bitcoin did *not* undergo a comparable technical transition--there was no Bitcoin-side event that could serve as a placebo or counterfactual. The two chains also have fundamentally different baseline dynamics, validator structures, and ecosystem compositions. Using Bitcoin as a DiD control would require a parallel trends assumption that is difficult to justify given these structural differences. The event study approach is more appropriate because it compares Ethereum to *itself* before and after the Merge, avoiding the need to assume comparability with a fundamentally different blockchain.

**Parallel trends.** We have examined the pre-treatment coefficients carefully. In the lagged analysis with 60-day intervals, the coefficient at tau=-120 is statistically significant at +0.082 bits--but notably, this is *positive*, meaning Bitcoin was *more* decentralized relative to Ethereum 120 days before the ban. This is the *opposite* direction of our treatment effect (-0.209 bits), so any pre-existing differential would make our estimate *conservative* rather than inflated. The coefficients at tau=-60 (−0.023, p > 0.05) and tau=-180 (−0.008, p > 0.05) are both small and insignificant. The absence of a systematic negative pre-trend--and the fact that the one significant pre-treatment coefficient goes in the opposite direction--supports rather than undermines identification. We have added finer-interval analyses at 10-day and 50-day intervals that provide additional support, and the visual evidence in Figure 3 shows closely parallel trends before the ban.

**Day_t coding.** We have clarified: "the number of days relative to the treatment date, taking negative values before treatment (e.g., Day_t = -30 for 30 days before), zero at the treatment date, and positive values after treatment."

**Clustering in single-chain analyses.** The reviewer correctly identifies that clustering by blockchain is meaningless when analyzing a single chain. The revised table notes now specify the appropriate standard errors for each analysis:

> Section 4.2, Table 5 notes: Heteroskedasticity-robust standard errors.

> Section 4.3, Table 6 notes: Standard errors are clustered by month.

**Gini interpretation.** The increase in the Gini coefficient alongside increases in entropy and node count is not contradictory but reflects a specific growth pattern: new entrants are predominantly *smaller* validators. When many small participants join, measured inequality increases because their shares are small relative to existing large validators, even though overall decentralization (entropy) improves due to greater participation and more distributed block production.

> Section 4.3: This increase in entropy can be attributed to the addition of around 680 new nodes, direct evidence of the barrier-reduction mechanism predicted by virtualization theory. The accompanying increase in the Gini coefficient of 0.088 indicates that these new entrants are predominantly smaller validators, which increases measured inequality while improving overall decentralization through broader participation. Interestingly, the analyses show no significant change in the Nakamoto coefficient or the HHI. This implies that the number of nodes that control 51% of the network remained similar despite the increase in the broader base of the network, consisting mainly of smaller new entrants.

The null Nakamoto and HHI results are consistent with a barrier-reduction mechanism that primarily affects the extensive margin--the number of new, smaller validators entering the network--rather than the intensive margin of concentration among top validators. Full redistribution at the top of the distribution may require longer time horizons or additional mechanisms beyond resource flexibility alone.

This is precisely why we use Shannon entropy as our primary measure--it captures both the number of participants *and* the distribution of power, providing a more holistic view of decentralization than any single metric.

**Generalizability.** We have added a paragraph to the limitations section acknowledging that our findings are derived from a small number of blockchains observed during specific shock events. While these blockchains represent the largest and most economically significant consensus networks, the contextual idiosyncrasies of each quasi-experiment limit extrapolation:

> Section 5.2: Regarding generalizability, our findings are derived from a small number of blockchains observed during specific shock events. While these blockchains represent the largest and most economically significant consensus networks, the contextual idiosyncrasies of each quasi-experiment (a national policy ban, a single infrastructure provider's decision, and a long-planned protocol upgrade) limit the extent to which our results can be extrapolated to all blockchain systems or shock types. We view our findings as strongly suggestive evidence for the role of resource flexibility, with external validity to be established by future research across a broader set of blockchains and disruptions.

---

### 5.3 Major Issue 3: Theoretical Mechanisms

*I suggest that the empirical analysis should **go beyond the comparisons between chains, shocks, and times (before vs. after) to test the theoretical mechanisms** and highlight their evidence. In the theory section, it is argued that blockchain virtualization enhances decentralization by **(1) "offering resource flexibility for rapid deployment and disaster recovery"** and **(2) "democratizing participation by reducing barriers to entry"**... **the second mechanism was not clearly unpacked**.*

We now provide direct empirical evidence for both mechanisms:

**Mechanism 1: Rapid deployment and disaster recovery.** The comparison between the China ban and Hetzner shutdown directly tests this mechanism. Both are "forced relocation" shocks, but the recovery dynamics differ dramatically by resource flexibility:

> Section 2.2: To understand the potential role of virtualization in blockchain decentralization, we examine two key contributions of virtualization to decentralization: 1) offering resource flexibility for rapid deployment and disaster recovery, and 2) democratizing participation by reducing barriers to entry.

- Bitcoin (ASICs, inflexible): Decentralization recovery took over 6 months. Miners needed to physically relocate specialized hardware to new jurisdictions.
- Solana (tokens, highly flexible): Decentralization recovery took 43 days. Validators re-delegated tokens to alternative infrastructure.

> Section 4.2: By dividing the shock of 0.344 bits by the positive slope post-shock of 0.008 bits per day, we calculate that Solana took 43 days to fully recover from the shock.

The 43-day figure is informative because it provides a concrete benchmark for how quickly token-based systems can reconstitute after infrastructure disruption--roughly the time needed for validators to procure alternative cloud hosting and re-stake. By contrast, ASIC-based recovery requires physical logistics (shipping, facility construction, power contracts) that operate on fundamentally different timescales.

**Mechanism 2: Democratizing participation by reducing barriers.** The Ethereum Merge provides direct evidence for this mechanism. The transition from PoW to PoS eliminated the need for expensive GPUs, cheap electricity, and specialized technical expertise, replacing these with a requirement of 32 ETH and consumer-grade hardware. The result was approximately 680 new nodes:

> Section 4.3: The Merge was a software upgrade that changed Ethereum's consensus mechanism from PoW to PoS. Thus, the Merge removed the need for physical hardware, thereby making Ethereum more virtualized by definition, and allowed anyone with 32 ETH and even consumer-grade computers to participate in Ethereum's consensus.

> Section 4.3: This increase in entropy can be attributed to the addition of around 680 new nodes.

The decomposition across five metrics reveals a signature that is specific to barrier reduction: entropy rises (more participants with meaningful shares), Gini rises (new entrants are smaller than incumbents), while Nakamoto and HHI remain unchanged (the top of the distribution is untouched). Alternative explanations would produce different signatures--economies-of-scale consolidation would reduce entropy and nodes while lowering Gini; generic growth would increase nodes without changing Gini. The observed pattern uniquely identifies the extensive margin as the channel: new, smaller validators entered because the 32-ETH threshold replaced the capital-intensive GPU mining infrastructure that previously excluded them.

---

### 5.4 Minor Issues

**Item 4: China ban timeline**

*Could you **clarify the timeline of the "rolling enforcement"** of China's ban on crypto mining?*

The enforcement of China's ban was a rolling process, not an instantaneous shutdown:

- **May 15, 2021:** Ban announced; enforcement began at the national level but was implemented by provincial authorities at different times.
- **May-June 2021:** Mining activity continued as miners had time to either relocate operations abroad or wind down. Figure E.2 showing mining activity from China during this period is consistent with gradual provincial compliance.
- **July 2021:** Full enforcement achieved; Chinese hashrate dropped to near zero.
- **Post-July 2021:** Decentralization effects became fully apparent after miners had fully exited or consolidated.

The observation that negative effects occurred *after* the ban (not during) is consistent with this rolling timeline: the decentralization impact materialized once the exodus was complete, not during the transition period when miners were still relocating. We have clarified this timeline in the manuscript:

> Section 3.1: This policy was a rolling ban starting around May 15, 2021, and enforced by local authorities in the next months (Shen, 2021). While the exact dates of the enforcement are not public, the hashrates dropped to a trough at the start of July 2021.

We validated our exposure measures using geographic hashrate data from the Cambridge Centre for Alternative Finance.

---

**Item 5: Trade-offs**

*I would like **more specifics on what these trade-offs are**.*

We have elaborated on three specific trade-offs, and we now frame the broader tension through what we term the *specificity-flexibility tradeoff*:

1. **Security vs. Flexibility:** More flexible resources may be easier for attackers to acquire, potentially enabling faster concentration of power for attacks. Our evidence shows the defensive side--flexibility also enables faster recovery--but the offensive implications warrant further research.

2. **Efficiency vs. Decentralization:** Higher decentralization typically involves more nodes, which can reduce throughput and increase latency. PoS systems partially address this through delegation mechanisms, but the fundamental tension remains.

3. **Governance complexity:** More decentralized networks face greater coordination costs for upgrades and governance decisions. The Ethereum Merge itself required years of coordination despite the network's relatively concentrated validator set.

> Section 5.1: First, the data suggests that design elements emphasizing resource flexibility are associated with a blockchain's ability to maintain decentralization in the face of external shocks. However, this flexibility may come with trade-offs. More flexible resources may be easier for attackers to acquire, potentially enabling faster concentration of power for attacks, though our evidence shows flexibility also enables faster defensive recovery. Higher decentralization typically involves more nodes, which can reduce throughput and increase latency. And more decentralized networks face greater coordination costs for upgrades and governance decisions, as illustrated by the years of coordination required for the Ethereum Merge itself. Moreover, the optimal level of resource flexibility may depend on the threat environment: as Garratt and van Oordt (2023) show, inflexibility can be protective when shocks target mining *rewards*, whereas our results demonstrate that flexibility is protective when shocks target the *resources* themselves.

The final point--that the optimal flexibility level depends on the threat environment--is a key insight for blockchain designers. It means there is no universally superior consensus mechanism; rather, the choice involves a genuine engineering tradeoff that depends on which threats a network considers most salient.

---

**Item 6: O-ring analogy**

*I believe the **content in footnote 4 is more important and relevant than the O-ring analogy** for illustrating catastrophic failures in blockchain networks.*

We agree. We have moved the Ronin hack ($625M) and 51% attacks content from the footnote to the main text in the introduction, where these concrete examples now appear prominently.

> Section 1: Failure to sustain decentralization in blockchain consensus mechanisms can cause catastrophic failures that lead to the loss of billions of dollars of economic value and data integrity regarding asset ownership. For example, the Ronin blockchain was hacked in 2022 for $625 million because of centralized points of failure and 51% attacks occur frequently and have significant and lasting negative effects on token prices.

These concrete examples now appear in the main text where they anchor the reader's understanding of what is at stake, rather than being relegated to a footnote where they competed with an abstract analogy for the reader's attention.

---

**Item 7: Missing Gnosis description**

*On page 15, four permissionless blockchains are mentioned, but only three are described, and **details of Gnosis are missing**.*

We have added a description of Gnosis:

> Section 3.2: Gnosis, an Ethereum sidechain originally designed for fast and low-cost transactions, previously used Proof of Authority (PoA) with a limited set of validators but transitioned to PoS on December 8, 2022, which uses staked native tokens (i.e., GNO) to achieve consensus.

This description now ensures that readers understand Gnosis's consensus mechanism history, which is relevant both to its role in the Hetzner synthetic control donor pool and to the accurate characterization of blockchain consensus types discussed throughout the paper.
