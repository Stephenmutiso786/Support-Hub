function isAdmin(user) {
  return user.role === 'admin';
}

function ensureClientScope(user, requestedClientId) {
  if (isAdmin(user)) {
    return requestedClientId ? Number(requestedClientId) : null;
  }

  if (!user.client_id) {
    throw new Error('User has no client scope');
  }

  if (requestedClientId && Number(requestedClientId) !== Number(user.client_id)) {
    throw new Error('Forbidden client scope');
  }

  return Number(user.client_id);
}

function ensureAgentScope(user, requestedAgentId) {
  if (isAdmin(user)) {
    return requestedAgentId ? Number(requestedAgentId) : null;
  }

  if (user.role === 'agent') {
    if (!user.agent_id) {
      throw new Error('User has no agent scope');
    }

    if (requestedAgentId && Number(requestedAgentId) !== Number(user.agent_id)) {
      throw new Error('Forbidden agent scope');
    }

    return Number(user.agent_id);
  }

  return requestedAgentId ? Number(requestedAgentId) : null;
}

module.exports = {
  isAdmin,
  ensureClientScope,
  ensureAgentScope,
};
