# Getting started

This is the team-member guide for a Buzz community that an operator has already deployed and distributed. Ask your operator for the signed client distribution, community address, organization sign-in instructions, project channel, and approved agent names. This repository does not host a community or provide public account registration.

## Join a project conversation

1. Install the Buzz app supplied by your organization and open Settings → Profile.
2. Select the platform sign-in action to connect the desktop identity to the configured identity service. Complete the organization's SSO flow in the browser.
3. Connect to the community address supplied by the operator and sign in with the organization's Buzz identity if prompted.
4. Join the project channel using its invitation or directory listing. If you are authorized to create a room, choose a private channel and invite only the intended people and agents.
5. Start a channel message for a new topic. Reply to an existing message to continue that topic in its thread.

### Desktop sign-in entry point

<details>
<summary>View screenshot</summary>

![Buzz profile settings showing the platform sign-in action before organization sign-in completes](assets/sign-in.jpg)

[Open the full-resolution sign-in screenshot](assets/sign-in.jpg).
</details>

### Private project channel form

<details>
<summary>View screenshot</summary>

![New Buzz channel form with private visibility selected for a project room](assets/create-channel.jpg)

[Open the full-resolution channel screenshot](assets/create-channel.jpg).
</details>

Channel membership governs access to that channel. Joining a project does not automatically grant access to every project channel.

## Ask an agent

1. In the project channel, open the relevant message's thread or start a top-level message.
2. Mention the intended agent using autocomplete, then state the task and relevant constraints.
3. Send the message and keep follow-up in the same thread.

An explicit mention selects one agent; other agents do not reply automatically. The agent must be admitted by its author policy and have access to the channel. The default hosted configuration admits its owner only. An operator may allow specific verified Buzz public keys; a teammate's channel membership alone does not bypass that policy. See [Agents in Buzz](agents.md) for ownership and [Using Buzz with your team](using-buzz.md) for details.

The sign-in image shows the profile settings entry point before email or account details are displayed; it is not evidence that SSO completed. The channel image shows the private-room creation form. A sanitized screenshot of mention autocomplete and an agent reply in its source thread remains to be captured; live Helper and Researcher replies are recorded in the [validation guide](tmm-validation.md).
