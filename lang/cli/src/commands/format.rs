//! Format command - formats a .rune file

use std::fs;
use std::path::Path;

/// Format a .rune file
pub fn format(input_path: &Path, check_only: bool) -> Result<bool, String> {
    let content = fs::read_to_string(input_path)
        .map_err(|e| format!("Failed to read {}: {}", input_path.display(), e))?;

    let formatted = format_content(&content);

    if check_only {
        // Return true if already formatted, false if needs formatting
        Ok(content == formatted)
    } else {
        // Write formatted content
        fs::write(input_path, &formatted)
            .map_err(|e| format!("Failed to write {}: {}", input_path.display(), e))?;
        Ok(true)
    }
}

/// Format rune content
fn format_content(content: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut in_block = false;
    let mut consecutive_empty = 0;
    let mut after_step = false;
    // Are we inside a [PLY] block? Its case steps/faults nest one level deeper
    // (8/10). The block closes at a blank line, the next top-level declaration, a
    // [NEW]/[RET], or a step that returns to REQ level. We can't infer that from
    // the already-normalized output, so track it as state and use the AUTHOR'S
    // original indent to tell a case step (deep) from a step that closes the
    // block (shallow) — otherwise the REQ's terminal step gets folded into the
    // last [CSE], silently changing meaning.
    let mut in_poly = false;

    for line in content.lines() {
        let trimmed = line.trim();
        let orig_indent = line.len() - line.trim_start().len();

        if trimmed.is_empty() {
            consecutive_empty += 1;
            // Keep max 2 consecutive empty lines between REQs
            if consecutive_empty <= 2 {
                lines.push(String::new());
            }
            in_block = false;
            after_step = false;
            // Do NOT reset in_poly here: a blank line is legal/cosmetic inside a
            // [PLY] body, so it must not collapse the poly block. The block is
            // closed when the next non-blank step returns to REQ-level indent
            // (handled below via the `in_poly && orig_indent >= 6` check) or by a
            // [REQ]/[DTO]/[TYP]/[NON]/[NEW]/[RET] tag.
            continue;
        }

        consecutive_empty = 0;

        // Normalize line based on content
        if trimmed.starts_with("[REQ]") {
            // REQ at column 0
            lines.push(trimmed.to_string());
            in_block = true;
            after_step = false;
            in_poly = false;
        } else if trimmed.starts_with("[DTO]") || trimmed.starts_with("[TYP]") || trimmed.starts_with("[NON]") {
            // Definitions at column 0
            lines.push(trimmed.to_string());
            in_block = true;
            after_step = false;
            in_poly = false;
        } else if trimmed.starts_with("[PLY]") {
            // Opens a polymorphic block; the tag itself sits at REQ-step level (4).
            lines.push(format!("    {}", trimmed));
            after_step = false;
            in_poly = true;
        } else if trimmed.starts_with("[NEW]") || trimmed.starts_with("[RET]") {
            // REQ-level tags at 4 spaces; they close any open poly block.
            lines.push(format!("    {}", trimmed));
            after_step = false;
            in_poly = false;
        } else if trimmed.starts_with("[CSE]") {
            // A case only appears inside a [PLY] block — at 8 spaces.
            lines.push(format!("        {}", trimmed));
            after_step = false;
            in_poly = true;
        } else if is_step_line(trimmed) {
            // A step is 8 spaces only when it's genuinely nested in a poly case —
            // i.e. the author indented it past REQ level. A step at REQ level
            // (shallow) closes the block and stays at 4, even right after a [PLY].
            let indent = if in_poly && orig_indent >= 6 {
                8
            } else {
                in_poly = false;
                4
            };
            lines.push(format!("{}{}", " ".repeat(indent), trimmed));
            after_step = true;
        } else if after_step && orig_indent >= 6 && is_fault_line(trimmed) {
            // Faults at 6 spaces (or 10 inside a poly case). Only a line that the
            // author ALREADY placed at fault level (indent >= 6) is treated as a
            // fault — this mirrors the parser, which only recognizes a Fault at
            // actual_indent >= 6 (parser lib.rs). Free-text prose after a step
            // (typically at the description indent 4) is all-lowercase too, so
            // without this guard it would be misclassified as a fault and
            // re-indented to 6, fabricating fault names and changing meaning.
            let indent = if in_poly { 10 } else { 6 };
            lines.push(format!("{}{}", " ".repeat(indent), trimmed));
        } else if in_block && (trimmed.starts_with("//") || !trimmed.contains(':')) {
            // Description or comment lines at 4 spaces
            lines.push(format!("    {}", trimmed));
            after_step = false;
        } else {
            // Preserve original indentation for unknown lines
            lines.push(line.to_string());
            after_step = false;
        }
    }

    // Remove trailing empty lines
    while lines.last() == Some(&String::new()) {
        lines.pop();
    }

    // Ensure final newline
    let mut result = lines.join("\n");
    if !result.is_empty() {
        result.push('\n');
    }

    result
}

fn is_step_line(s: &str) -> bool {
    let boundary_prefixes = ["db:", "fs:", "mq:", "ex:", "os:", "lg:"];
    for prefix in boundary_prefixes {
        if s.starts_with(prefix) {
            return true;
        }
    }
    (s.contains('.') || s.contains("::")) && s.contains('(') && s.contains(')')
}

fn is_fault_line(s: &str) -> bool {
    let parts: Vec<&str> = s.split_whitespace().collect();
    !parts.is_empty() && parts.iter().all(|p| {
        p.chars().all(|c| c.is_lowercase() || c.is_numeric() || c == '-')
            && p.chars().next().map(|c| c.is_lowercase()).unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn formats_req_at_column_zero() {
        let content = "   [REQ] test.run(In): Out";
        let formatted = format_content(content);
        assert!(formatted.starts_with("[REQ]"));
    }

    #[test]
    fn formats_steps_at_four_spaces() {
        let content = "[REQ] test.run(In): Out\nid::create(name): id";
        let formatted = format_content(content);
        assert!(formatted.contains("\n    id::create(name): id"));
    }

    #[test]
    fn formats_faults_at_six_spaces() {
        // A fault the author placed at a real fault position (indent >= 6)
        // normalizes to exactly 6 spaces. (We do NOT promote an indent-0 line to
        // a fault — that would fabricate faults from prose; see R5. The parser
        // only recognizes a Fault at actual_indent >= 6.)
        let content = "[REQ] test.run(In): Out\n    db:storage.save(): void\n        not-found";
        let formatted = format_content(content);
        assert!(formatted.contains("\n      not-found"), "got:\n{formatted}");
    }

    #[test]
    fn check_only_returns_false_for_unformatted() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, "   [REQ] test.run(In): Out").unwrap();

        let result = format(&input_path, true);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Should need formatting
    }

    #[test]
    fn check_only_returns_true_for_formatted() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, "[REQ] test.run(In): Out\n").unwrap();

        let result = format(&input_path, true);
        assert!(result.is_ok());
        assert!(result.unwrap()); // Should be formatted
    }

    #[test]
    fn normalizes_consecutive_empty_lines() {
        let content = "[REQ] a.run(In): Out\n\n\n\n\n[REQ] b.run(In): Out";
        let formatted = format_content(content);
        // Should have at most 2 empty lines between REQs
        assert!(!formatted.contains("\n\n\n\n"));
    }

    #[test]
    fn terminal_step_after_ply_stays_at_req_level() {
        // The REQ's final step sits at indent 4 right after a [PLY] block; it must
        // NOT be folded into the last [CSE] (which would change its meaning).
        let input = "[REQ] n.send(InDto): OutDto\n    [PLY] ch.deliver(InDto): OutDto\n        [CSE] email\n        ex:ch.mail(InDto): OutDto\n          timeout\n    n.toDto(): OutDto\n";
        let out = format_content(input);
        // the terminal step keeps 4 spaces; the case step stays at 8
        assert!(out.contains("\n    n.toDto(): OutDto"), "terminal step must stay at indent 4, got:\n{out}");
        assert!(out.contains("\n        ex:ch.mail(InDto): OutDto"), "case step must stay at indent 8");
    }

    #[test]
    fn r5_prose_after_step_is_not_treated_as_fault() {
        // Free-text prose after a step (all lowercase words, originally at the
        // description indent 4) must be treated as a description (indent 4), not
        // misclassified as a fault and re-indented to 6.
        let input = "[REQ] r.run(InDto): OutDto\n    id::create(name): id\n    creates a brand new id\n";
        let out = format_content(input);
        assert!(
            out.contains("\n    creates a brand new id"),
            "prose after a step must stay at description indent 4, got:\n{out}"
        );
        assert!(
            !out.contains("\n      creates a brand new id"),
            "prose after a step must NOT be re-indented to fault level 6, got:\n{out}"
        );
    }

    #[test]
    fn r2_blank_line_inside_poly_does_not_collapse_case() {
        // A blank line between two case steps is legal/cosmetic inside a [PLY]
        // body. It must NOT collapse the poly block: the case step after the
        // blank must stay at case level (8), not be re-indented to REQ level (4).
        let input = "[REQ] n.send(InDto): OutDto\n    [PLY] ch.deliver(InDto): OutDto\n        [CSE] email\n        ex:ch.mail(InDto): OutDto\n\n        ex:ch.log(InDto): OutDto\n";
        let out = format_content(input);
        assert!(
            out.contains("\n        ex:ch.log(InDto): OutDto"),
            "case step after a blank line must stay at indent 8, got:\n{out}"
        );
    }

    #[test]
    fn description_with_punctuation_is_untouched() {
        // (sanity) descriptions are free text; the formatter shouldn't choke on them
        let input = "[DTO] FooDto: x\n    an alert to rafac@monsterrg.com e.g. WGS\n";
        let out = format_content(input);
        assert!(out.contains("rafac@monsterrg.com e.g. WGS"));
    }
}
