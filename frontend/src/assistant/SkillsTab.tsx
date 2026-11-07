import { useChats } from './chatStore';

export function SkillsTab() {
  const skills = useChats((s) => s.skills);
  const activeId = useChats((s) => s.activeId);
  const setInput = useChats((s) => s.setInput);
  const setPaneTab = useChats((s) => s.setPaneTab);

  return (
    <div className="skills-tab">
      <table className="skills-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>Name</th>
            <th>Description</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <tr
              key={skill.command}
              className={`skill-row${skill.status === 'active' ? ' active' : ' planned'}`}
              onClick={() => {
                if (skill.status === 'active') {
                  setInput(activeId, skill.command + ' ');
                  setPaneTab('assistant');
                }
              }}
            >
              <td>{skill.command}</td>
              <td>{skill.name}</td>
              <td>{skill.description}</td>
              <td>
                <span className={`badge ${skill.status}`}>{skill.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
