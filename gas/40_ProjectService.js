/**
 * 프로젝트(분류) 관리. 삭제 대신 사용 중지(active=FALSE)만 제공한다.
 * 이미 일정·작업기록에 연결된 프로젝트가 사라지는 것을 막기 위해서다.
 */

function toProjectDto_(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color || DEFAULT_PROJECT_COLOR,
    sortOrder: Number(r.sort_order) || 0,
    active: isTrue_(r.active),
    updatedAt: r.updated_at,
  };
}

function compareProjects_(a, b) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

function listProjects_() {
  return readAll_(SHEETS.PROJECTS).map(toProjectDto_).sort(compareProjects_);
}

function saveProject_(input) {
  requireObject_(input);
  const id = vOptionalId_(input.id, 'projectId');
  const name = vText_(input.name, 'projectName', { required: true, max: LIMITS.PROJECT_NAME });
  const color = vColor_(input.color);
  const sortOrder = vInt_(input.sortOrder, 'sortOrder', 0, LIMITS.SORT_ORDER_MAX, 0);
  const active = input.active === undefined ? true : vBool_(input.active);
  const expectedUpdatedAt = id ? vUpdatedAt_(input.updatedAt) : undefined;

  return withLock_(function () {
    const rows = readAll_(SHEETS.PROJECTS);
    const duplicate = rows.some(function (r) {
      return r.id !== id && String(r.name).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) invalid_(t_('project.duplicate'));

    const stamp = nowStamp_();
    if (!id) {
      const created = {
        id: uuid_(), name: name, color: color, sort_order: String(sortOrder),
        active: toBoolString_(active), created_at: stamp, updated_at: stamp,
      };
      insertRow_(SHEETS.PROJECTS, created);
      return toProjectDto_(created);
    }

    const row = findById_(rows, id);
    if (!row) fail_(ERROR_CODES.NOT_FOUND, t_('project.notFound'));
    if (row.updated_at !== expectedUpdatedAt) {
      fail_(ERROR_CODES.CONFLICT, t_('err.conflictUpdate', t_('entity.project')));
    }
    const updated = Object.assign({}, row, {
      name: name, color: color, sort_order: String(sortOrder),
      active: toBoolString_(active), updated_at: stamp,
    });
    updateRow_(SHEETS.PROJECTS, row._row, updated);
    return toProjectDto_(updated);
  });
}

/**
 * 일정·작업기록에 지정할 프로젝트 확인.
 * 사용 중지된 프로젝트는 새로 지정할 수 없지만, 기존 값을 그대로 두는 수정은 허용한다.
 */
function assertProjectAssignable_(projectId, previousProjectId) {
  if (!projectId) return;
  const project = findById_(readAll_(SHEETS.PROJECTS), projectId);
  if (!project) invalid_(t_('project.selectedMissing'));
  if (!isTrue_(project.active) && projectId !== previousProjectId) invalid_(t_('project.inactive'));
}
