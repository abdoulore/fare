---
name: Fare
description: Pay once in shielded ZEC, then call an API with tokens that cannot be matched to your payment.
colors:
  sheet-paper: "#f6f7f5"
  stamp-white: "#ffffff"
  postmark-ink: "#1b2232"
  ink-muted: "#525a69"
  perforation-line: "#dde0e5"
  perforation-edge: "#858b97"
  vermilion: "#c2341d"
  ultramarine: "#2b3f9e"
  stamp-green: "#1d6a44"
  album-black: "#111216"
  album-paper: "#f3f4f1"
  album-ink: "#e9eaee"
  album-muted: "#a3a8b4"
  album-line: "#2a2d35"
  album-vermilion: "#ff7a5c"
  album-ultramarine: "#9bb0ff"
  album-green: "#6fd39f"
typography:
  display:
    fontFamily: "Big Shoulders Display Variable, Arial Narrow, sans-serif"
    fontSize: "clamp(2.6rem, 7vw, 4.6rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "0.005em"
  headline:
    fontFamily: "Big Shoulders Display Variable, Arial Narrow, sans-serif"
    fontSize: "clamp(1.9rem, 4.6vw, 3rem)"
    fontWeight: 800
    lineHeight: 0.98
  title:
    fontFamily: "Big Shoulders Display Variable, Arial Narrow, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 800
    lineHeight: 0.98
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  lede:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Martian Mono Variable, ui-monospace, monospace"
    fontSize: "0.78rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
  code:
    fontFamily: "Martian Mono Variable, ui-monospace, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  tag: "2px"
  control: "3px"
spacing:
  gutter-phone: "16px"
  gutter-wide: "32px"
  stack: "14px"
  band: "56px"
  measure: "34em"
  page: "1120px"
components:
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.stamp-white}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "46px"
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.postmark-ink}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "46px"
  button-developer:
    backgroundColor: "{colors.ultramarine}"
    textColor: "{colors.stamp-white}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "46px"
  tag:
    textColor: "{colors.postmark-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 8px"
  tag-paid:
    textColor: "{colors.stamp-green}"
    rounded: "{rounded.tag}"
    padding: "4px 8px"
  tag-refused:
    textColor: "{colors.vermilion}"
    rounded: "{rounded.tag}"
    padding: "4px 8px"
  panel:
    backgroundColor: "{colors.stamp-white}"
    textColor: "{colors.postmark-ink}"
    rounded: "{rounded.control}"
    padding: "20px"
  stamp:
    backgroundColor: "{colors.stamp-white}"
    textColor: "{colors.postmark-ink}"
    padding: "10px"
---

# Design System: Fare

## Overview

**Creative North Star: "The Sheet of Stamps"**

A pack is a sheet of 100 stamps, and every call cancels one with a postmark that names no sender. The site is built from the materials of philately: gummed sheet paper, perforations, condensed stamp lettering, sheet-margin inscriptions in small mono capitals, and the postmark's double ring with its wavy bars. Each side of the product owns one ink. The buyer's side and the primary action are vermilion, the developer and issuer side ultramarine, proof and cancellations postmark blue-black, and paid is stamp green.

The surfaces are flat and printed. Depth comes from paper on paper (white stamps and panels on a cool sheet, or mounted on a black album page in the dark scheme), never from shadows. Each route opens on a sheet margin of plain paper with dark lettering, its inscription and a closing row of perforations in its side's ink, then settles into a calm reading or working column. Colour is kept for actions and selected details, so the paper dominates (owner, Oct 26: the full vermilion fields were too loud). Motion is limited to the ink: a postmark presses and its bars strike on, a refused replay bounces, a counter ticks. Reduced motion removes all of it.

The site refuses the crypto default (dark, neon, coins, padlocks), the cream editorial look, and the SaaS dashboard of metric cards and sidebars. State is named in postal terms: postage due (underpaid), already cancelled (a replayed token), returned (a key the directory does not list).

**Key Characteristics:**
- One ink per side of the product, carried by inscriptions, perforation rows, actions and details, never by a full-bleed field.
- Perforation is the only divider device: stamp edges, margin edges, the "no link" seam, rails and section rules.
- Stamps and panels are paper in both schemes; they carry the light inks locally.
- Display lettering is condensed, uppercase and heavy; reading text is Atkinson at a 34em measure.
- Every status a buyer sees is also a word, never color alone.

## Colors

Four printing inks on cool white paper, with a black album page for the dark scheme.

### Primary
- **Vermilion** (`{colors.vermilion}`): the buyer's side and the primary action. Home and App inscriptions and perforation rows, primary buttons, the logo, the frame of Home's code stamp, stamps in a pane, refusals and the replay postmark. In dark mode the page uses Album Vermilion for text and lines on black, while margins keep the print value.

### Secondary
- **Ultramarine** (`{colors.ultramarine}`): the developer and issuer side. The Developers masthead and header, its rail and section perforations, the Developers button, the dashed "publishes its key" line, focus rings and text selection.

### Tertiary
- **Stamp Green** (`{colors.stamp-green}`): paid only. The paid tag, the done step, the green postmark tone.

### Neutral
- **Postmark Ink** (`{colors.postmark-ink}`): text, cancellations, the Proof masthead and the diagram's chain and directory heads.
- **Ink Muted** (`{colors.ink-muted}`): secondary text, labels, edge labels.
- **Sheet Paper** (`{colors.sheet-paper}`): the page in light mode, cool white and never cream.
- **Stamp White** (`{colors.stamp-white}`): stamps, panels, code blocks and the diagram figure.
- **Perforation Line** (`{colors.perforation-line}`) and **Perforation Edge** (`{colors.perforation-edge}`): hairlines, field borders and perforation dots.
- **Album Black** (`{colors.album-black}`) with **Album Paper** (`{colors.album-paper}`): the dark scheme's page and the paper mounted on it.

### Named Rules
**The One Ink Per Side Rule.** A route's inscription, perforation row and accents take the ink of the side it serves: vermilion for Home and App, ultramarine for Developers, postmark ink for Proof. Do not mix a second accent into a margin.

**The Paper Stays Paper Rule.** Stamps, panels, code blocks and figures keep their light inks in the dark scheme. They are paper mounted on the album page, not dark cards.

**The Word Beside The Color Rule.** Green, vermilion and ultramarine never carry state alone. A tag, a step label or a postmark inscription names it.

## Typography

**Display Font:** Big Shoulders Display (with Arial Narrow)
**Body Font:** Atkinson Hyperlegible Next (with system-ui)
**Label/Mono Font:** Martian Mono (with ui-monospace)

**Character:** Condensed, heavy stamp lettering for every heading, set uppercase and tight, against a hyperlegible reading face. Martian Mono plays the sheet-margin inscription: serial numbers, prices, labels, code and status. All three are OFL and self-hosted.

### Hierarchy
- **Display** (800, `clamp(2.6rem, 7vw, 4.6rem)`, 0.98): the one h1 per route, in ink on the paper sheet margin.
- **Headline** (800, `clamp(1.9rem, 4.6vw, 3rem)`, 0.98): section headings on Home; `clamp(1.7rem, 3.6vw, 2.4rem)` inside documents and 1.8rem inside app panels.
- **Title** (800, 1.45rem): step and door headings.
- **Body** (400, 1.0625rem, 1.6): reading text, held to a 34em measure; the lede is 1.2rem at 30em.
- **Label** (500, 0.78rem, 0.08em, uppercase): sheet-margin inscriptions, nav, table heads, TOC, the seam.
- **Code** (400, 0.78rem, 1.65): code blocks. Inline mono is 0.86em of its context and never compounds.

### Named Rules
**The Inscription Below The Heading Rule.** Sheet-margin inscriptions sit under the lede or at the margin's foot, never above a heading as a kicker.

**The Fitted Ring Rule.** Postmark inscriptions are sized to fit their half ring (Martian Mono advances 0.7 em) and kept short enough to stay at or above 8px. A string that would need less is shortened, not shrunk.

## Layout

A single 1120px column with 16px gutters on phones and 32px from 760px. Each route opens on a paper sheet margin (Home's carries the pitch and the code stamp, the others a heading, lede and inscription), closed by a row of 2.4px perforation dots every 13px in the side's ink. Home continues in 56px bands divided by hairlines. Developers and Proof are documents: a 220px sticky table of contents on a perforated rail beside the reading column from 960px, sections divided by a perforated rule. App is a working grid, the purchase and use panels at 1.4fr beside the buyer's sheet at 1fr from 960px, one column below.

The issuer and the API are always shown as two halves of one sheet torn along a perforation labelled "no link": side by side from 860px (the issuer half wider on Proof), stacked with a horizontal seam below. Tables become labelled cards below 640px. Proof's transactions set each label beside its value. No route scrolls sideways at 375px, which a test holds.

## Elevation & Depth

Flat by design. There are no box shadows anywhere. Depth is paper on paper: Stamp White panels and stamps on Sheet Paper, or Album Paper mounted on Album Black, separated by a 1px Perforation Line border or by a perforated mask edge.

### Named Rules
**The Printed Not Raised Rule.** Never add a shadow, bevel or emboss to suggest a stamp. A stamp is defined by its perforated edge and its paper color.

## Shapes

Corners are nearly square: 3px on buttons, fields, panels and code blocks, 2px on tags. The signature silhouette is the perforation, drawn with a CSS mask (round holes cut along the padding box, the content box solid) on stamps and pane stamps, and as dot rows for sheet-margin edges, seams, rails and dividers. The postmark is a 2.6px outer ring and 1.4px inner ring with text on both half arcs and five wavy bars.

## Components

### Buttons
- **Shape:** nearly square (3px), 46px tall, 11px by 18px padding, Atkinson 600 at 1rem.
- **Primary:** Vermilion with white text; hover mixes 12% black into the vermilion.
- **Default:** transparent with a 1.5px Postmark Ink border; hover tints 8% ink.
- **Developer:** Ultramarine with white text, used for the way into Developers.
- **Focus:** a 2px outline in the focus ink (ultramarine) at 3px offset.

### Tags
- **Style:** Martian Mono 600 at 0.76rem, uppercase, 1.5px border in currentColor, 2px corners. They wrap rather than overflow, and never wrap inside a table cell.
- **State:** paid in Stamp Green, refused and postage due in Vermilion, developer in Ultramarine, simulated and neutral in ink.

### Cards / Containers
- **Panel:** Stamp White, 1px Perforation Line border, 3px corners, 20px padding. App panels hold steps, the ask box, the sheet and the receipt.
- **Stamp:** Stamp White with a perforated mask edge (5px holes on a 15px pitch) and 14px by 16px inner padding. Home's code stamp is the only large one; it is printed in a vermilion frame (the perforated rim plus a 7px border) around its white design.

### Inputs / Fields
- **Style:** 1.5px Perforation Edge border, 3px corners, 11px by 13px padding, the page or paper as fill.
- **Focus:** the shared focus outline. The caret and checkbox accent are vermilion.

### Navigation
- **Style:** Martian Mono 500 at 0.78rem, uppercase, 0.06em tracking, set as margin inscription at the right of the header. The current route and hover carry a 2px underline in currentColor. On phones the nav wraps under the mark.

### Postmark
The signature mark. A double ring with fitted inscriptions on both half arcs, a center line and five wavy cancellation bars. It presses in (0.32s) and its bars strike on (0.5s) once when mounted. Tones: ink (cancel), vermilion (refused) and green (paid). It is the live 402 check on Home and the "already cancelled" replay bounce in App, always with role img and a full sentence label.

### Pane of stamps
One sheet of 100 small perforated vermilion stamps per pack, ten across, up to ten sheets. Spent stamps fade to 62% and carry the ink cancel (a ring and three wavy bars). A blank sheet is drawn in outline before a purchase is signed. Two small sheets fit a phone row; the buyer's own sheet is the large size.

### Code block
A paper bar above the code with its file or context name in mono capitals and the copy button at the right, joined to the code by a dashed rule. The code scrolls inside its block and nothing sits over it.

## Do's and Don'ts

### Do:
- **Do** open every route on a paper sheet margin, its inscription and perforation row in the side's ink.
- **Do** keep colour for actions and selected details: red for primary actions and the stamps, blue for developer content, green for paid.
- **Do** show the issuer and the API as two halves torn along a "no link" perforation whenever both appear.
- **Do** name state in postal terms beside its color: postage due, already cancelled, returned, paid.
- **Do** keep stamps, panels, code and figures on light paper in the dark scheme.
- **Do** draw tokens as stamps in sheets of 100, spent ones cancelled with the ink postmark bars.
- **Do** label anything simulated on the element itself (the "simulated" tag on every canned answer).

### Don't:
- **Don't** fill a sheet margin or header with a full-bleed ink field.
- **Don't** use cream, warm beige or editorial off-white grounds. Sheet Paper is cool white.
- **Don't** use the crypto default: dark neon, coins, padlocks, glowing gradients.
- **Don't** build a dashboard of metric cards or a sidebar shell.
- **Don't** add shadows, bevels or emboss to stamps or panels.
- **Don't** set an inscription above a heading as a kicker or eyebrow.
- **Don't** load a font, image or script from another origin. All type is self-hosted.
- **Don't** let a postmark inscription run past its arc, and don't shrink one below 8px to make it fit.
