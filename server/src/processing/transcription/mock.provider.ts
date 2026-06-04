import { Readable } from 'node:stream';
import { TranscriptionProvider, TranscriptionResult } from './transcription-provider.interface';

/**
 * Deterministic STT for local dev / tests (USE_MOCK_AI=true). Drains the audio
 * stream (so R2 reads are exercised) and returns a realistic home-inspection
 * walkthrough so the compile + PDF stages have meaningful input end-to-end.
 */
export class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribe(audio: Readable): Promise<TranscriptionResult> {
    // Drain the stream to mirror real I/O and release the R2 connection.
    await drain(audio);
    return { text: SAMPLE_TRANSCRIPT };
  }
}

async function drain(stream: Readable): Promise<void> {
  for await (const _chunk of stream) {
    // discard
  }
}

const SAMPLE_TRANSCRIPT = [
  "Alright, starting the inspection at the front of the property.",
  "The roof is asphalt shingle, looks to be about fifteen years old. I see some granule loss on the south-facing slope and two shingles are lifted near the ridge. That's going to need repair before the next winter.",
  "Gutters are full of debris and the downspout on the northeast corner is disconnected, so water is draining right against the foundation. Recommend cleaning the gutters and reattaching the downspout — maintenance item.",
  "Moving to the exterior siding. Vinyl siding is in good condition overall, just some minor fading on the west wall, nothing structural.",
  "At the electrical panel in the garage. It's a 200 amp panel, looks modern. However there's a double-tapped breaker on circuit twelve, that's a safety concern and should be corrected by a licensed electrician.",
  "The water heater is a forty gallon gas unit, manufactured 2016. No TPR discharge pipe installed on the relief valve — that's a safety issue, needs a proper discharge line.",
  "In the kitchen, the GFCI outlets near the sink are working and tripping correctly. Dishwasher runs fine. Under the sink there's a small active leak at the P-trap, minor but should be repaired.",
  "Upstairs bathroom, the exhaust fan vents into the attic instead of outside, which can cause moisture problems. Recommend rerouting to an exterior vent.",
  "Attic insulation is adequate, blown-in fiberglass, no signs of pest activity. Some daylight visible at the roof penetration around the plumbing vent, minor air sealing recommended.",
  "Basement is dry, no efflorescence on the walls. The sump pump tested fine. Furnace is a high-efficiency unit serviced this year per the tag.",
  "Overall the home is in serviceable condition with a few safety items to address. That concludes the walkthrough.",
].join(' ');
