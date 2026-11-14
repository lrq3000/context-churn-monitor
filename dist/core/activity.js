export const excerpt = (value, limit = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
/** Prefer the host's own human title; tool-specific prefixes are deterministic and incur no model invocation. */
export function toolSummary(name, input = {}, hostTitle) {
    const tool = name.split(/[.:/]/).at(-1) ?? name;
    let label = 'Tool', title = name;
    if (/^(shell|bash|exec_command)$/.test(tool)) {
        label = 'Shell command';
        title = input.command ?? input.cmd ?? name;
    }
    else if (/^(read|read_file)$/.test(tool)) {
        label = 'Read file';
        title = (input.path ?? input.file_path ?? name) + (input.offset ? ` · line ${input.offset}` : '');
    }
    else if (/^(patch|apply_patch|edit|write)$/.test(tool)) {
        label = 'Patch';
        title = input.path ?? input.file_path ?? /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(input.patchText ?? input.patch ?? '')?.[1] ?? name;
    }
    else if (/^(skill|load_skill)$/.test(tool)) {
        label = 'Load skill';
        title = input.id ?? input.name ?? name;
    }
    else if (/^(subagent|task)$/.test(tool)) {
        label = 'Subagent';
        title = input.description ?? input.prompt ?? name;
    }
    else if (/^(grep|glob|search)$/.test(tool)) {
        label = 'Search';
        title = input.pattern ?? input.query ?? name;
    }
    return { label, title: excerpt(typeof hostTitle === 'string' && hostTitle.trim() ? hostTitle : title) };
}
