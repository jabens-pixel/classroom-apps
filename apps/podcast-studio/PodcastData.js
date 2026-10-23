// ============================================================================
// Podcast Studio -- ALL the unit's content, as data. Edit here, not in the page code.
//
//   PC_LIBRARY      the Listening Library (real episodes, linked -- never copied)
//   PC_PARTS        "Anatomy of a podcast" glossary (original wording)
//   PC_UNIT         three weeks; each week holds activities in order
//   PC_RUBRICS      7-level rubrics (Process, Script) -- written for this app; change freely
//   PC_FINAL_RUBRIC the Final Episode rubric -- the teacher's own wording, copied exactly
//
// Activity forms
//   lesson      reading/watching, not scored, nothing to turn in   (sections[])
//   fields      boxes the student fills in and turns in            (fields[])
//               field kinds: long (a writing box with writing stats), short, link (https),
//               choice (options[]), episode (pick from the library), rows (a table: cols[])
//               showIf: {field, eq} hides a field unless another field has that answer
//   quiz        multiple choice that scores itself                 (mc[])
//   discussion  post first, then see classmates and reply
// Grading: quiz = auto; rubric: 'process' | 'script' = the 7-level rubric; criteria: true = the
// Final Episode rubric (each criterion scored, the total is the grade); anything else is
// Complete / Partly / Incomplete (complete: {complete, incomplete} says what each means).
// Activity ids are where students' work is filed. NEVER rename an id once students have started.
// ============================================================================

var PC_UNIT_TITLE = 'Podcast Studio';

// ---------------------------------------------------------------------------- Listening Library
var PC_LIBRARY = [
  { id: 'storycorps_qa', show: 'StoryCorps', title: 'Q&A (Sarah and Joshua Littman)', url: 'https://storycorps.org/stories/sarah-and-joshua-littman/', alt: 'https://storycorps.org/animation/q-and-a/',
    length: '3 min', format: 'Interview', craft: 'Short and complete',
    why: 'About as long as your own episode will be. One honest conversation, cut down to its best moments, is enough to make a whole story.' },
  { id: 'moth_48', show: 'The Moth', title: '48 Inches (David Levy)', url: 'https://themoth.org/stories/48-inches',
    length: 'about 8 min', format: 'Storytelling (solo)', craft: 'Structure with only a voice',
    why: 'No music, no editing tricks: one person on a stage. Listen for the hook, the rising stakes, the turn, and the reflection at the end. A good model for a solo show.',
    note: 'Use this single-story page. The full radio hour it aired in has other stories that aren’t school-appropriate.' },
  { id: 'songexploder_st', show: 'Song Exploder', title: 'Stranger Things (Main Title Theme)', url: 'https://songexploder.net/stranger-things', alt: 'https://podcasts.apple.com/us/podcast/kyle-dixon-michael-stein-stranger-things-main-title-theme/id788236947?i=1000394054818',
    length: '11 min', format: 'Interview (host edited out)', craft: 'Theme music and editing',
    why: 'The host’s questions are cut out, so the guests seem to narrate on their own. You also hear a famous theme taken apart layer by layer, which helps when you choose your own intro music.' },
  { id: 'shortwave_scream', show: 'NPR Short Wave', title: 'The Sound of Fear: Why Do Animals Scream?', url: 'https://www.npr.org/2024/10/30/1211596886/halloween-horror-science-scream', alt: 'https://podcasts.apple.com/us/podcast/the-sound-of-fear-why-do-animals-scream/id1482575855?i=1000674930135',
    length: '14 min', format: 'Explainer (two hosts)', craft: 'Sound as evidence',
    why: 'A tight science explainer that uses real recordings as proof, not decoration. Notice how the hosts set up each sound before you hear it.',
    note: 'Includes some sudden, high-pitched screams.' },
  { id: 'sysk_bread', show: 'Stuff You Should Know', title: 'Short Stuff: The Best Episode Since Sliced Bread', url: 'https://podcasts.apple.com/us/podcast/short-stuff-the-best-episode-since-sliced-bread/id278981407?i=1000684990469',
    length: '15 min', format: 'Conversation (two hosts)', craft: 'Chemistry and a loose plan',
    why: 'Two hosts talk through researched facts. Listen for how a conversation that sounds relaxed is still following a plan, and for the show’s intro and outro.' },
  { id: 'nightvale_pilot', show: 'Welcome to Night Vale', title: 'Episode 1: Pilot', url: 'https://podcasts.apple.com/us/podcast/1-pilot/id536258179?i=1000366951147', alt: 'https://www.welcometonightvale.com/',
    length: '22 min', format: 'Audio fiction', craft: 'Segments and world-building',
    why: 'Fiction dressed up as a small-town radio show, with announcements, a weather break and a sign-off. Easy to map segment by segment, and a model for fiction podcasts.' },
  { id: 'radiolab_emilie', show: 'Radiolab', title: 'Finding Emilie', url: 'https://radiolab.org/podcast/110206-finding-emilie',
    length: '39 min (the main story is the first 25)', format: 'Narrative (produced)', craft: 'Story arc, music and narration',
    why: 'A full story arc built from interviews, with music raising the tension and the hosts stepping in between clips to move the story forward.',
    note: 'A serious accident and a long recovery. Emotional, but school-appropriate.' },
  { id: 'npr_student_2023', show: 'Real Mississippi (student-made)', title: 'How the Jackson Water Crisis Affects Education', url: 'https://www.npr.org/2023/07/28/1190775900/the-jackson-water-crisis-through-a-student-journalists-eyes', alt: 'https://open.spotify.com/episode/5dISmtTl8ti6MAMBiM3hOQ',
    length: '8 min', format: 'Student podcast · NPR Student Podcast Challenge winner', craft: 'Opening sound and interviews',
    why: 'Made by a high school student. It opens with an everyday sound, keeps real sound under the narration, and mixes a personal interview with an official source.' },
  { id: 'npr_student_2024', show: 'The Suburban (student-made)', title: 'A Relationship Behind Bars', url: 'https://www.npr.org/2024/10/14/nx-s1-5108634/parental-incarceration-father-podcast', alt: 'https://creators.spotify.com/pod/profile/the-suburban/episodes/A-Relationship-Behind-Bars-e2j78hi',
    length: 'a few minutes', format: 'Student podcast · NPR Student Podcast Challenge winner', craft: 'Cold open and two-part structure',
    why: 'A student’s first podcast, made for an intro class. It opens cold with a letter read aloud, then moves in two clear halves.',
    note: 'About a parent in prison. Handled with care, but a personal subject.' }
];

// ---------------------------------------------------------------------------- Anatomy of a podcast
var PC_PARTS = [
  { group: 'The open', items: [
    { term: 'Cold open', def: 'The first moment of the episode, before any music or welcome: a sound, a line of dialogue, a question. It drops the listener into the middle of something.' },
    { term: 'Hook', def: 'Whatever makes someone decide, in the first 20–30 seconds, to keep listening. Often a question the episode promises to answer.' },
    { term: 'Theme music / intro', def: 'The same short piece of music every episode, usually with the show’s name. It tells regular listeners where they are.' },
    { term: 'Host welcome', def: 'Who you are, what the show is, and what this episode is about, in a sentence or two.' } ] },
  { group: 'The middle', items: [
    { term: 'Segment', def: 'One part of the episode with its own job: a story, an interview, a debate, a list. Most episodes have two to four.' },
    { term: 'Transition (bumper, sting)', def: 'A line, a beat of silence or a short music sting that tells the listener one part is ending and another is starting.' },
    { term: 'Narration (tracking)', def: 'The host speaking straight to the listener to explain, connect clips or move the story forward.' },
    { term: 'Interview', def: 'A conversation with a guest who knows or lived something. The host’s questions shape it; editing keeps the best answers.' },
    { term: 'Sound bite (actuality)', def: 'A short clip of real recorded audio: a person’s voice, a crowd, a bell. It brings real people and places into the episode.' },
    { term: 'Ambient (natural) sound', def: 'Background sound of a place: a cafeteria, rain, a gym. A few seconds of it puts the listener in the room.' },
    { term: 'Music bed', def: 'Quiet music under someone talking. It sets a mood and smooths edits, as long as it never fights the voice.' } ] },
  { group: 'The close', items: [
    { term: 'Wrap-up', def: 'What the listener should walk away with: the answer to the hook’s question, or the idea that ties it together.' },
    { term: 'Call to action', def: 'What you ask the listener to do next: share it, try something, listen to the next episode.' },
    { term: 'Outro and credits', def: 'The sign-off, the theme music again, and who made it (crew, guests, music).' } ] },
  { group: 'Around the episode', items: [
    { term: 'Episode title', def: 'Short and specific. It should make someone curious, not just say “Episode 1”.' },
    { term: 'Show notes', def: 'A few sentences people read before they press play: what it’s about, who is in it, music credits.' },
    { term: 'Cover art', def: 'The square image every podcast app shows. It has to be readable when it’s the size of a thumbnail.' },
    { term: 'Run sheet', def: 'The plan for recording: every segment in order, with times and the sound that goes in it.' } ] }
];

// ---------------------------------------------------------------------------- rubrics
var PC_RUBRICS = {
  process: [
    { score: 1, label: 'Incomplete', text: 'No process yet, or a list of steps with nothing else.' },
    { score: 2, label: 'Minimal', text: 'A few stages, with no reasons and no timeline.' },
    { score: 3, label: 'Developing', text: 'Stages and some milestones, but the reasons are thin (“because it’s important”) or the dates are vague.' },
    { score: 4, label: 'Adequate', text: 'Clear stages, reasons and dated milestones, with a central question, source notes and a basic plan for another voice.' },
    { score: 5, label: 'Proficient', text: 'A purposeful process with realistic milestones. At least two sources are identified and evaluated, evidence is connected to the episode, and five open questions plus two follow-ups prepare a meaningful second voice. Roles and recording permission are clear.' },
    { score: 6, label: 'Strong', text: 'An organized workflow with credible research, thoughtful questions and a plan to cross-check claims. It anticipates retakes, a guest’s schedule and a backup voice; milestones and roles fit together.' },
    { score: 7, label: 'Exemplary', text: 'An achievable process designed for this topic: sources and missing perspectives are weighed carefully, questions invite specific stories, and every production choice has a clear purpose. Someone else could run the project from it.' }
  ],
  script: [
    { score: 1, label: 'Incomplete', text: 'No script or run sheet yet.' },
    { score: 2, label: 'Minimal', text: 'A few lines or a list of topics; nothing an episode could follow.' },
    { score: 3, label: 'Developing', text: 'A run sheet or draft exists, but the hook, the segments or the ending are missing.' },
    { score: 4, label: 'Adequate', text: 'A complete run sheet (open → segments → close) and a script or talking points for each part.' },
    { score: 5, label: 'Proficient', text: 'A hook in the first 20 seconds, clear segments with transitions, planned sound, and a real ending with a call to action. Written to be heard, not read.' },
    { score: 6, label: 'Strong', text: 'Tight, purposeful writing: every segment earns its time, sound bites and music have a reason, and the voice fits the show’s tone.' },
    { score: 7, label: 'Exemplary', text: 'It already sounds like a real episode: a memorable hook, smooth transitions and an ending that stays with the listener.' }
  ]
};
// The Final Episode rubric: the teacher's own Canvas rubric, word for word. Each criterion is scored
// 0–7 (halves allowed); the bands are the teacher's point levels.
var PC_FINAL_RUBRIC = [
  { id: 'ideas', label: 'Ideas, Research, and Organization', standards: 'W.11-12.2, W.11-12.4, W.11-12.7, W.11-12.8', max: 7, bands: [
    { score: 7, text: 'The podcast presents an insightful, engaging, and well-developed topic. Research is thorough, evidence is seamlessly integrated, and ideas are organized with strong transitions. The episode flows logically with a clear introduction and conclusion.' },
    { score: 6, text: 'The podcast presents a clear and focused topic with relevant research and supporting ideas. Organization is logical and easy to follow, with a clear beginning, middle, and end.' },
    { score: 5, text: 'The topic is somewhat clear but lacks depth or consistent focus. Research and supporting evidence are limited or inconsistently connected. Organization is uneven, with weak transitions.' },
    { score: 2, text: 'The topic is unclear or underdeveloped. Research is minimal or missing, and ideas are disorganized or incomplete.' } ] },
  { id: 'voice', label: 'Voice, Style, and Delivery', standards: 'SL.11-12.4, SL.11-12.5, W.11-12.4', max: 7, bands: [
    { score: 7, text: 'Delivery is confident, engaging, and polished. Tone, pacing, and emphasis enhance meaning and hold the listener’s attention. Sound quality, music, and effects are clear, balanced, and purposeful.' },
    { score: 6, text: 'Delivery is clear and expressive. Tone and pacing generally fit the content. Sound is mostly clear with minimal distractions.' },
    { score: 5, text: 'Delivery is uneven or lacks energy. Tone or pacing sometimes distracts from content. Audio or effects may be inconsistent or poorly balanced.' },
    { score: 2, text: 'Delivery is unclear, monotone, or rushed. Audio quality or technical issues make the podcast difficult to follow.' } ] }
];

// ---------------------------------------------------------------------------- the three weeks
var PC_CANVA_DEFAULTS = { cover: '', runsheet: '' };   // optional teacher Canva links; built-in starters are always available

var PC_UNIT = [
  // ======================================================== WEEK 1
  { n: 1, title: 'Listen Like a Producer', eq: 'What makes a listener stay for the whole episode?',
    summary: 'Hear a range of real podcasts, learn the parts every episode is built from, and figure out what keeps you listening.',
    activities: [
      { id: 'intro', form: 'lesson', icon: '🎙️', title: 'Podcast Creation: A Student’s Guide', sections: [
        { h: 'What makes a good podcast?', p: ['That’s the question for the next three weeks. You’ll listen to real podcasts like a producer does, take them apart to see how they’re built, and then make an episode of your own.'] },
        { h: 'Podcast Creation Overview', sub: 'A guide to launching your own podcast', list: ['Introduction and Podcast Basics', 'Planning Your Podcast', 'Recording and Using Canva', 'Conclusion and Next Steps'] },
        { h: 'How the three weeks go', cards: [
          { h: 'Week 1 · Listen like a producer', p: 'The Listening Library, the parts of a podcast, two listening logs, and a class discussion: what makes a good podcast?' },
          { h: 'Week 2 · Plan & script', p: 'Your show concept, research and source notes, a guest or second-voice plan, interview questions, a pitch, and your script and run sheet.' },
          { h: 'Week 3 · Record, build & publish', p: 'Record, build the episode and cover art in Canva, share it at the Listening Party, and reflect.' } ] },
        { h: 'What gets recorded', p: ['When you write in this app, it keeps track of your word count, how long you spend writing in each box, and anything you paste in. Your teacher can see it. It isn’t a verdict on anything; it helps your teacher see how your work came together.'] }
      ] },
      { id: 'anatomy', form: 'lesson', icon: '🧩', title: 'Anatomy of a Podcast', parts: true, sections: [
        { h: 'Every episode is built from parts', p: ['Once you can name the parts, you can hear them in any podcast, and you can choose which ones to use in your own. Keep this page open while you do your listening logs.'] }
      ] },
      { id: 'partsquiz', form: 'quiz', icon: '✓', title: 'Parts of a Podcast Check', prompt: 'Use the Anatomy of a Podcast page if you need it.', mc: [
        { id: 'q1', q: 'The very first moment of an episode, before the theme music or the welcome, that drops you into the middle of something is called the…', choices: ['Cold open', 'Outro', 'Music bed', 'Show notes'], answer: 0, why: 'A cold open starts the episode in the middle of the action, before the show introduces itself.' },
        { id: 'q2', q: 'A short clip of real recorded audio, like a person speaking or a crowd cheering, dropped into an episode is a…', choices: ['Segment', 'Sound bite', 'Call to action', 'Run sheet'], answer: 1, why: 'Sound bites (also called actualities) bring real voices and places into the episode.' },
        { id: 'q3', q: 'A few seconds of a cafeteria’s noise under the host’s voice, so you feel like you’re there, is…', choices: ['Theme music', 'A transition', 'Ambient (natural) sound', 'A cold open'], answer: 2, why: 'Ambient sound is the background sound of a real place.' },
        { id: 'q4', q: 'The few sentences people read before they press play, with music credits and guests, are the…', choices: ['Script', 'Show notes', 'Tagline', 'Run sheet'], answer: 1, why: 'Show notes go with the episode in podcast apps.' },
        { id: 'q5', q: '“If this made you think, send it to a friend, and come back next week.” This line is a…', choices: ['Hook', 'Cold open', 'Call to action', 'Sound bite'], answer: 2, why: 'A call to action asks the listener to do something next.' },
        { id: 'q6', q: 'A run sheet is…', choices: ['Every word the host will say', 'The cover art file', 'A timed list of the episode’s segments, in order, with the sound for each', 'A list of podcast apps'], answer: 2, why: 'The run sheet is the recording plan; the script holds the words.' },
        { id: 'q7', q: 'Why do many shows play a short music sting between segments?', choices: ['To make the episode longer', 'To signal that one part is ending and another is starting', 'Podcast apps require it', 'To hide mistakes'], answer: 1, why: 'Transitions help the listener follow the structure, since they can’t see headings.' },
        { id: 'q8', q: 'Which is true about a freeform (unscripted) conversation show?', choices: ['It needs no preparation at all', 'It still needs a plan: talking points, questions and an order', 'It can’t have segments', 'It is always better than a scripted show'], answer: 1, why: 'Either way, you need to be prepared and organized before you record.' }
      ] },
      { id: 'listen1', form: 'fields', icon: '🎧', title: 'Listening Log 1', points: 5,
        prompt: 'Choose an episode from the Listening Library and listen like a producer. Pause and jot down times as you go.',
        complete: { complete: 'Every box answered with specific moments from the episode (times or quotes in your own words), at least four parts mapped, and one move to borrow.', incomplete: 'Missing boxes, a summary of what the episode is about instead of how it’s built, or no times.' },
        fields: [
          { id: 'episode', kind: 'episode', label: 'Which episode?', required: true },
          { id: 'hook', kind: 'long', label: 'The first 30 seconds', hint: 'How does it open? What made you want to keep listening (or not)?' },
          { id: 'map', kind: 'rows', label: 'Map the parts', hint: 'At least four. Use the names from Anatomy of a Podcast.', min: 4, cols: [{ id: 't', label: 'Time', w: 'sm', ph: '0:00' }, { id: 'part', label: 'Part', ph: 'Cold open' }, { id: 'does', label: 'What it does for the listener', w: 'lg' }] },
          { id: 'sound', kind: 'long', label: 'Sound', hint: 'Music, ambient sound, sound bites: what did you hear, and what did each one add?' },
          { id: 'voice', kind: 'long', label: 'Voice', hint: 'How does the host sound: pace, energy, tone? Does it fit the show?' },
          { id: 'stay', kind: 'long', label: 'Where you leaned in, and where you drifted', hint: 'Give one moment of each, with the time.' },
          { id: 'steal', kind: 'long', label: 'One move to borrow', hint: 'Something this episode does that you could use in yours.', rows: 3 }
        ] },
      { id: 'listen2', form: 'fields', icon: '🎧', title: 'Listening Log 2', points: 5,
        prompt: 'Choose a DIFFERENT kind of episode from your first one (if Log 1 was an interview, try a story, an explainer or fiction).',
        complete: { complete: 'A different format from Log 1, every box answered with specific moments, at least four parts mapped, and a real comparison.', incomplete: 'The same kind of episode as Log 1, missing boxes, or no comparison.' },
        fields: [
          { id: 'episode', kind: 'episode', label: 'Which episode?', required: true },
          { id: 'hook', kind: 'long', label: 'The first 30 seconds', hint: 'How does it open? What made you want to keep listening (or not)?' },
          { id: 'map', kind: 'rows', label: 'Map the parts', hint: 'At least four.', min: 4, cols: [{ id: 't', label: 'Time', w: 'sm', ph: '0:00' }, { id: 'part', label: 'Part', ph: 'Segment' }, { id: 'does', label: 'What it does for the listener', w: 'lg' }] },
          { id: 'sound', kind: 'long', label: 'Sound and voice', hint: 'What you heard (music, ambient sound, sound bites, the host’s delivery) and what it added.' },
          { id: 'compare', kind: 'long', label: 'Built differently', hint: 'How is this episode built differently from the one in Log 1? Which approach fits the show YOU want to make, and why?' },
          { id: 'steal', kind: 'long', label: 'One move to borrow', rows: 3 }
        ] },
      { id: 'goodpod', form: 'discussion', icon: '💬', title: 'What Makes a Good Podcast?', points: 3,
        prompt: 'Name the three ingredients you think matter most in a good podcast. For each one, point to a moment from an episode you heard (the show and about when it happens). Then reply to a classmate: add an ingredient they missed, or push back on one with your own example.',
        complete: { complete: 'A post with three ingredients, each tied to a specific moment in a real episode, and a reply that adds to or challenges a classmate’s list with an example.', incomplete: 'No post, ingredients with no examples, or no reply.' } }
    ] },

  // ======================================================== WEEK 2
  { n: 2, title: 'Plan & Script', eq: 'How do you turn an idea into something people want to hear?',
    summary: 'Develop your show, research its central question, prepare another voice, and write a timed script.',
    activities: [
      { id: 'planning', form: 'lesson', icon: '🗺️', title: 'Planning Your Podcast', sections: [
        { h: 'Start here: Week 2 video', video: { id: 'UnVOrHv3eck', title: 'Week 2 opening video', url: 'https://www.youtube.com/watch?v=UnVOrHv3eck' } },
        { h: 'Planning Your Podcast', sub: 'Key Steps for Successful Podcast Creation', cards: [
          { h: 'Concept Development', p: 'Selecting a niche or theme that resonates with students\' interests is crucial. This ensures the content is engaging and sustains listeners\' attention throughout the podcast episodes.' },
          { h: 'Naming Your Podcast', p: 'A memorable title not only captures the essence of your show but also reflects its tone. This is essential for attracting listeners and establishing brand identity.' },
          { h: 'Episode Planning', p: 'Outline your episodes with clear segment structures. Decide between scripting or freeform discussions to maintain focus while allowing for natural conversations during recording sessions.' } ] },
        { h: 'Episode Planning Essentials', cards: [
          { h: 'Scripting vs. Freeform Approaches', p: 'Decide between structured scripts or conversational style. Either way, you need to be prepared and organized before you record.' },
          { h: 'Using Sound Bites', p: 'You will need to plan on how to get authentic sound bites that will add to your episode.' },
          { h: 'Preparing Guest Questions Effectively', p: 'Formulate engaging questions to guide discussions.' } ] },
        { h: 'Bring another voice into the story', p: ['Include a meaningful contribution from someone besides the main narrator: an interview, a recorded response, a short set of street-style interviews, a co-host with a different perspective, or a guest reading or performing a part. A full interview is encouraged, but your whole episode does not have to be an interview.', 'Choose someone for what they can contribute. Introduce them, frame the clip, and explain what their voice helps the listener understand. A greeting or random quote is not enough. Ask permission before recording and agree on how the clip will be shared.'] },
        { h: 'Research before questions', steps: ['Write one central question that your episode will explore.', 'Find at least two useful sources. Record the author or organization, title, date, and a link or other way to find each source. A firsthand interview can be one source; cross-check factual claims with another.', 'Take notes in your own words. Separate facts you can verify from opinions and personal experiences. Explain why each source is worth trusting and what it cannot tell you.', 'Mark where each useful detail belongs in your episode. Then list what you still need to ask your guest. For fiction or personal storytelling, research the setting, background or lived experience that will make the story convincing.'] },
        { h: 'Questions that get a story', cards: [
          { h: 'Open with an experience', p: 'Instead of “Do you like your job?”, ask “Take me through a moment that shows what your work is really like.”' },
          { h: 'Ask for a scene', p: '“Where were you? What could you see or hear? What happened next?” Specific memories give listeners something to picture.' },
          { h: 'Follow the answer', p: '“You said it changed your mind. What changed it?” Listen for surprising words instead of rushing to the next prepared question.' },
          { h: 'Check and close', p: '“How do you know that?” “Who sees this differently?” “What have I not asked that matters?” Verify factual claims after the conversation.' } ] },
        { h: 'Solo or crew?', p: ['You can make your show alone or with a crew of 2–4. A solo episode should run 8 minutes. Crew episodes should be longer than 8 minutes, with meaningful contributions from every member. Plan enough substance for the running time; do not pad it with silence or extra music. Either way, you turn in your own planning and your own reflection, and you’re graded on your own work. Crews share one finished episode. If you’re in a crew, your Creation Process includes a Collaboration Plan.'] }
      ] },
      { id: 'concept', form: 'fields', icon: '💡', title: 'Show Concept', points: 5,
        prompt: 'Decide what your show is. Be specific: “a podcast about sports” is a topic; “a podcast where two benchwarmers rank the weirdest rules in high school sports” is a show.',
        complete: { complete: 'A specific niche, a real audience, a name and tagline that fit the tone, a format, and a first-episode idea with a clear question or story.', incomplete: 'A broad topic only, missing boxes, or no episode idea.' },
        fields: [
          { id: 'name', kind: 'short', label: 'Show name', required: true },
          { id: 'tagline', kind: 'short', label: 'Tagline', hint: 'One line under the name: “A podcast about…”' },
          { id: 'niche', kind: 'long', label: 'The niche', hint: 'What is your show about, exactly? Why does it interest you?', rows: 3 },
          { id: 'audience', kind: 'short', label: 'Who is it for?' },
          { id: 'tone', kind: 'short', label: 'Tone in three words', hint: 'e.g. curious, funny, honest' },
          { id: 'format', kind: 'choice', label: 'Format', options: ['Narrative story', 'Interview', 'Conversation (co-hosts)', 'Explainer', 'Audio fiction / drama', 'A mix'] },
          { id: 'crew', kind: 'choice', label: 'Solo or crew?', options: ['Solo', 'Crew'] },
          { id: 'members', kind: 'short', label: 'Your crew', hint: 'Names of everyone in your crew', showIf: { field: 'crew', eq: 'Crew' } },
          { id: 'ep1', kind: 'long', label: 'Episode 1 idea', hint: 'What is the first episode about? What question does it answer or what story does it tell?', rows: 4 }
        ] },
      { id: 'pitch', form: 'discussion', icon: '📣', title: 'Pitch Board', points: 3,
        prompt: 'Pitch your show in 4–5 sentences: the name, what it’s about, who it’s for, and why someone would press play on episode 1. Then reply to TWO classmates: “I’d listen because…” and “It would grab me even more if…”.',
        complete: { complete: 'A pitch with the name, niche, audience and a reason to listen, plus two replies that each name something specific to keep and something to improve.', incomplete: 'No pitch, a pitch missing the basics, or fewer than two useful replies.' } },
      { id: 'process', form: 'fields', icon: '🎙️', title: 'Research, Questions & Process', points: 7, rubric: 'process',
        assignment: true,
        prompt: 'Prepare the evidence and voices your episode needs, then design your production process. Write a central question, take notes from at least two sources, plan another voice, and prepare five open questions plus two possible follow-ups. For a performed or co-hosted piece, use the questions to explore the perspective you are adding. Keep your own planning even when working with a crew.',
        fields: [
          { id: 'central', kind: 'long', label: 'Research brief: what is your central question?', hint: 'What will listeners understand by the end? What do you already think, and what do you still need to find out?', rows: 3 },
          { id: 'sources', kind: 'rows', label: 'Source notebook: at least two sources', hint: 'Use your own words. Identify who made the source and how to find it; explain its value and limitations.', min: 2, cols: [{ id: 'source', label: 'Author, title, date and link', w: 'lg' }, { id: 'notes', label: 'Useful evidence / notes', w: 'lg' }, { id: 'trust', label: 'Why trust it? Limits?', w: 'lg' }, { id: 'use', label: 'Where will you use it?', w: 'lg' }] },
          { id: 'verify', kind: 'long', label: 'What needs checking or another perspective?', hint: 'Name a claim to cross-check, an unanswered question, or a perspective missing from your sources.', rows: 3 },
          { id: 'voice', kind: 'choice', label: 'How will another voice contribute?', options: ['Interview with a guest', 'Recorded response or short voice memo', 'Several short interviews', 'Co-host with a distinct perspective', 'Guest reading or performance'] },
          { id: 'interview', kind: 'choice', label: 'Will this include a full interview?', options: ['No', 'Yes'] },
          { id: 'guest', kind: 'short', label: 'Whose voice, and why them?', hint: 'Name or role, relevant experience, and the perspective this person adds.' },
          { id: 'questions', kind: 'rows', label: 'Five prepared questions / conversation prompts', hint: 'Ask one thing at a time. Invite examples, scenes, reasons and a different perspective. Avoid leading or yes/no questions.', min: 5, cols: [{ id: 'q', label: 'Question', w: 'lg' }] },
          { id: 'permission', kind: 'long', label: 'Recording and permission plan', hint: 'When and how will you record? Explain the project, ask permission before recording, and agree on the audience and name/credit. Do not enter private contact information.', rows: 3 },
          { id: 'followups', kind: 'rows', label: 'Two possible follow-ups', hint: 'Prepare prompts, then adapt them to what the person actually says: “Can you give an example?” or “What happened next?”', min: 2, cols: [{ id: 'q', label: 'Follow-up prompt', w: 'lg' }, { id: 'purpose', label: 'What might this reveal?', w: 'lg' }] },
          { id: 'stages', kind: 'rows', label: '1. Design Your Process', hint: 'The key stages from idea to finished podcast, and why each one matters for your success. You can also describe it as a paragraph or link a flowchart below.', min: 4, cols: [{ id: 'stage', label: 'Stage', ph: 'Research' }, { id: 'what', label: 'What I’ll do', w: 'lg' }, { id: 'why', label: 'Why it’s important', w: 'lg' }] },
          { id: 'paragraph', kind: 'long', label: 'Or describe your process as a paragraph (optional)', rows: 4, optional: true },
          { id: 'flowchart', kind: 'link', label: 'Or link a flowchart (optional: Canva, Google Drawings…)', optional: true },
          { id: 'milestones', kind: 'rows', label: '2. Set Milestones', hint: 'Realistic dates that show steady progress, like “By Thursday, I will record my intro.”', min: 3, cols: [{ id: 'when', label: 'When', w: 'sm', ph: 'Thu' }, { id: 'goal', label: 'Milestone', w: 'lg' }] },
          { id: 'crew', kind: 'choice', label: 'Are you working with others?', options: ['No, I’m solo', 'Yes, I’m in a crew'] },
          { id: 'roles', kind: 'rows', label: '3. Collaboration Plan: who is responsible for what', showIf: { field: 'crew', eq: 'Yes, I’m in a crew' }, cols: [{ id: 'who', label: 'Crew member' }, { id: 'role', label: 'Responsible for', w: 'lg' }] },
          { id: 'cohesive', kind: 'long', label: 'How you’ll communicate and keep the podcast cohesive', showIf: { field: 'crew', eq: 'Yes, I’m in a crew' }, rows: 4 },
        ] },
      { id: 'scripting', form: 'lesson', icon: '✍️', title: 'Writing the Script', sections: [
        { h: 'Watch: how to write a podcast script', video: { id: 'rvkmVENzz7Q', title: 'Your 5 Step Guide to Writing a Podcast Script (Podcasting with Hiwi G)', url: 'https://www.youtube.com/watch?v=rvkmVENzz7Q' },
          p: ['As you watch, jot down: what a strong opening has to do, the steps for building a story, and one idea you’ll use in your first episode.'] },
        { h: 'Writing for the ear', list: [
          'Short sentences. Listeners can’t reread a line they missed.',
          'Say where you are in the episode: “First…”, “Here’s the surprise…”, “So what does this mean?”',
          'Set up every sound bite before it plays, so the listener knows who is talking.',
          'Read it out loud as you write. If you stumble, rewrite the sentence.',
          'Talking points are fine for a conversation show; write out the open and the close word for word anyway.' ] },
        { h: 'The run sheet', p: ['Before you write the words, plan the order: every segment, about how long it runs, and the sound in it. Open the built-in run-sheet starter below for an eight-minute example and a printable blank. Fill in your own saved run sheet in Script & Run Sheet.'], canva: 'runsheet' },
        { h: 'Sound bites', p: ['Plan how you’ll get your authentic sound bites: who you’ll record, where, and with what. Ambient sound counts: ten seconds of the place your story happens.'] }
      ] },
      { id: 'script', form: 'fields', icon: '📝', title: 'Script & Run Sheet', points: 7, rubric: 'script',
        prompt: 'Plan your episode segment by segment, then write it. Plan an 8-minute solo episode, or a longer episode if you are working with a crew. Time a read-through and include interviews, sound bites and transitions in your run sheet; the finished running time matters more than a word count. A crew turns in one script each: each person writes or revises their own parts and says which ones.',
        fields: [
          { id: 'runsheet', kind: 'rows', label: 'Run sheet', hint: 'Open → segments → close. Total: 8 minutes for solo; longer for crews. Time a rehearsal to check your estimates.', min: 5, cols: [{ id: 't', label: 'Time', w: 'sm', ph: '0:00' }, { id: 'seg', label: 'Segment', ph: 'Cold open' }, { id: 'what', label: 'What happens', w: 'lg' }, { id: 'sound', label: 'Sound', ph: 'Ambient: hallway' }] },
          { id: 'text', kind: 'long', label: 'Script', hint: 'Write the words. For a conversation show, write the open and close in full and talking points for the middle.', rows: 18, focus: true, minWords: 300 },
          { id: 'bites', kind: 'rows', label: 'Sound bites and music plan', cols: [{ id: 'what', label: 'Sound', w: 'lg', ph: 'Coach yelling a play' }, { id: 'from', label: 'Where it comes from', ph: 'Record at practice' }, { id: 'where', label: 'Where it goes', w: 'sm', ph: '0:40' }] },
          { id: 'mine', kind: 'short', label: 'Crews only: which parts did you write?', hint: 'Leave blank if you’re solo.', optional: true }
        ] }
    ] },

  // ======================================================== WEEK 3
  { n: 3, title: 'Record, Build & Publish', eq: 'How do sound and design change the way a message lands?',
    summary: 'Record your episode, build it and its cover art in Canva, share it at the Listening Party, and look back at your process.',
    activities: [
      { id: 'recording', form: 'lesson', icon: '🔴', title: 'Recording and Using Canva', sections: [
        { h: 'Recording Essentials', sub: 'Understanding equipment and recording techniques', cards: [
          { h: 'Equipment', p: 'You will likely record with your iphone, although our school does have some equipment you can use. Test your equipment and record in the quietest setting possible. Wind is your enemy when recording.' },
          { h: 'Recording Tips', p: 'Focus on maintaining a steady pace and clear enunciation while recording. This ensures your message is communicated effectively, engaging listeners with a polished audio experience.' },
          { h: 'Recording Options', p: 'Use Canva as the place to upload your audio recordings.' } ] },
        { h: 'Before you press record', list: [
          'Plan for an 8-minute finished solo episode, or a longer crew episode. Rehearse and time it before recording.',
          'Explain the project and audience, ask permission to record, and confirm the name or credit your guest wants. Give them space to decline a question.',
          'Listen without talking over the answer. Leave a short pause, then ask a follow-up. Keep the original meaning when editing a clip.',
          'Do a 10-second test, play it back, and listen with headphones.',
          'Phone about a hand’s width from your mouth, a little off to the side.',
          'Soft rooms sound better: a closet of coats or a car beats an echoing classroom.',
          'Record each segment as its own clip, so one mistake doesn’t mean starting over.',
          'Leave two seconds of silence at the start and end of every clip; it makes trimming easy.' ] },
        { h: 'Building your episode in Canva', steps: [
          'Open a new video design in Canva. Use your downloaded cover from the built-in cover maker, or create your own cover for the first page.',
          'Upload your recordings: Uploads → Upload files → pick the voice memos from your phone or Chromebook.',
          'Click a clip to add it, then use the timeline at the bottom to trim or split it.',
          'Add music from Elements → Audio. Turn its volume down under voices and trim it to fit.',
          'Play the whole thing from the start. Fix anything too quiet, too loud, or too long.',
          'Share → View-only link → copy. That link is what you turn in.' ] },
        { h: 'Using Canva Assets', sub: 'Enhance Your Podcast with Creative Designs', cards: [
          { h: 'Podcast Assets', p: 'Utilize Canva\'s extensive library of podcast templates and graphics to create eye-catching cover art, episode thumbnails, and social media posts that resonate with your audience and brand identity.' },
          { h: 'Template Customization', p: 'Customize templates in Canva to reflect your podcast\'s theme and style. Adjust colors, fonts, and images to ensure your branding is consistent across all visual materials for a professional look.' },
          { h: 'Engaging Audience', p: 'Use visually appealing designs to engage your audience on social media platforms. Regularly share updates, clips, and graphics to promote new episodes and maintain interest among your listeners.' } ], canva: 'cover' }
      ] },
      { id: 'cover', form: 'fields', icon: '🎨', title: 'Cover Art', points: 5,
        prompt: 'Use the built-in cover maker below or design your own square cover in Canva. Download your cover as a PNG, upload it into your Canva episode, and keep the show name readable at thumbnail size.',
        complete: { complete: 'A working Canva view-only link to square cover art with the show name readable at thumbnail size, and three design choices each tied to the show’s tone or audience.', incomplete: 'No link, a link that doesn’t open, or choices with no reasons.' },
        fields: [
          { id: 'coverTitle', kind: 'short', label: 'Cover title', hint: 'Used by the built-in cover maker. Leave blank to use your show name.' },
          { id: 'coverSubtitle', kind: 'short', label: 'Cover tagline', hint: 'A short line that helps listeners understand your show.' },
          { id: 'link', kind: 'link', label: 'Canva view-only link to your cover art', required: true, canva: true },
          { id: 'choices', kind: 'rows', label: 'Three design choices', hint: 'Color, font, image, layout: what you chose and why it fits your show.', min: 3, cols: [{ id: 'choice', label: 'Choice', ph: 'Dark blue + neon' }, { id: 'why', label: 'Why it fits my show', w: 'lg' }] }
        ] },
      { id: 'episode', form: 'fields', icon: '🎧', title: 'Final Episode', criteria: true,
        prompt: 'Turn in your finished episode: the Canva view-only link, the title and your show notes. Expectation: an 8-minute solo podcast; a longer episode for a crew, with meaningful contributions from everyone. Include a meaningful second voice and credit it. Crews: everyone turns in the same link, with their own show notes.',
        fields: [
          { id: 'link', kind: 'link', label: 'Canva view-only link to your episode', required: true, canva: true },
          { id: 'title', kind: 'short', label: 'Episode title', required: true },
          { id: 'length', kind: 'short', label: 'Length', hint: 'Minutes:seconds, e.g. 8:00. Solo: 8 minutes. Crews: longer than 8 minutes.' },
          { id: 'notes', kind: 'long', label: 'Show notes', hint: '2–4 sentences a listener reads before pressing play, plus guests.', rows: 4 },
          { id: 'voicecheck', kind: 'long', label: 'Where can we hear the other voice?', hint: 'Give the timestamp, who is speaking, what their contribution adds, and confirm permission to use the recording.', rows: 3 },
          { id: 'credits', kind: 'long', label: 'Credits and sources', hint: 'Crew and what each person did, guests, music and where it came from, research sources.', rows: 4 }
        ] },
      { id: 'party', form: 'discussion', icon: '🎉', title: 'Listening Party', points: 3,
        prompt: 'Post your episode’s title, a one-sentence teaser, and your Canva view-only link. Then listen to TWO classmates’ episodes and reply to each: one “glow” (a part of the podcast that worked, named with the term from Anatomy of a Podcast, and when it happens) and one “grow”.',
        complete: { complete: 'A post with the title, a teaser and a working link, plus two replies that each name a specific part (with the time) that worked and one thing to try.', incomplete: 'No post or link, or fewer than two specific replies.' } },
      { id: 'reflect', form: 'fields', icon: '↩', title: 'Producer’s Reflection', points: 5,
        prompt: 'Look back at the process you designed in Week 2. Be honest: the point is what you learned about making things.',
        complete: { complete: 'Every box answered with specifics from your own project (dates, stages, moments in the episode), including an honest look at what didn’t go to plan.', incomplete: 'Missing boxes, or general statements that could be about anyone’s project.' },
        fields: [
          { id: 'plan', kind: 'long', label: 'Your process vs. what really happened', hint: 'Which stages went as planned? Which changed, and why?' },
          { id: 'milestones', kind: 'long', label: 'Your milestones', hint: 'Which did you hit? Where did you fall behind, and what did you do about it?' },
          { id: 'proud', kind: 'long', label: 'The moment you’re proudest of', hint: 'Point to a moment in the episode (with the time) and say why it works.' },
          { id: 'next', kind: 'long', label: 'Episode 2', hint: 'If you made another episode, what would you change about your process?' },
          { id: 'eq', kind: 'long', label: 'The big question', hint: 'What makes a good podcast? Has your answer changed since Week 1?' }
        ] }
    ] }
];

// The Creation Process assignment exactly as the teacher wrote it (shown above the form).
var PC_PROCESS_ASSIGNMENT = {
  title: '🎙️ Podcast Creation Process Assignment',
  overview: ['In this assignment, you will create your own process for planning, producing, and reflecting on your podcast. Rather than following a strict template, you’ll design the workflow that works best for your topic and your creative style.',
    'Your process should show clear thinking about how you will plan, record, edit, and publish your podcast — and why you’re doing it that way.'],
  task: [
    { h: 'Design Your Process', list: ['Describe how you will move from your idea to a finished podcast.', 'Include key stages (for example: brainstorming, research, scripting, interviews, recording, editing, reflection).', 'Explain why each stage is important for your success.', 'You may present this as a paragraph description, flowchart, or numbered list.'] },
    { h: 'Set Milestones', list: ['Create a timeline for your project. (Example: “By Thursday, I will record my intro,” or “Week 2 – edit and finalize audio.”)', 'Make sure your milestones are realistic and show steady progress toward completion.'] },
    { h: 'Collaboration Plan (if applicable)', list: ['If you are working with others, explain who is responsible for what.', 'Describe how you will communicate and make sure your podcast stays cohesive.'] }
  ],
  tips: ['Be specific and intentional — don’t just list steps; explain why you chose them. - Add questions if you are going to interview someone.', 'Think like a designer: every good project starts with a clear workflow.', 'Your process is unique — there is no single “right” way, as long as it’s thoughtful, organized, and achievable.']
};
