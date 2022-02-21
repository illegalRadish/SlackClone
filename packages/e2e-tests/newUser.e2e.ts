import { fixture, test, Selector, t } from 'testcafe'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Channel, CreateCommunityModal, JoinCommunityModal, LoadingPanel, RegisterUsernameModal } from './selectors'

const longTimeout = 100000

fixture`Electron test`
  // .before(async t => {  // Before hook breaks the test -.-'
  //   const dataPath = path.join(os.homedir(), '.config')
  //   console.info('Cleaning up')
  //   try {
  //     fs.rmdirSync(path.join(dataPath, 'Quiet'), { recursive: true })
  //     fs.rmdirSync(path.join(dataPath, 'Electron'), { recursive: true })
  //     fs.rmdirSync(path.join(dataPath, 'e2e-tests-nodejs'), { recursive: true })
  //   } catch {
  //     console.info('No data directories to clean up')
  //   }
  // })
  
const goToMainPage = async () => {
  let pageUrl: string
  try {
    // Test built app version. This is a really hacky way of accessing proper mainWindowUrl
    pageUrl = fs.readFileSync('/tmp/mainWindowUrl', { encoding: 'utf8' })
  } catch {
    // If no file found assume that tests are run with a dev project version
    pageUrl = '../frontend/dist/main/index.html#/'
  }
  console.info(`Navigating to ${pageUrl}`)
  await t.navigateTo(pageUrl)
}

test('User can create new community, register and send few messages to general channel', async t => {
  await goToMainPage()

  // User opens app for the first time, sees spinner, waits for spinner to disappear
  await t.expect(new LoadingPanel('Starting Quiet').title.exists).notOk(`"Starting Quiet" spinner is still visible after ${longTimeout}ms`, { timeout: longTimeout })

  // User sees "join community" page and switches to "create community" view by clicking on the link
  const joinModal = new JoinCommunityModal()

  // const joinCommunityTitle = await Selector('h3').withText('Join community')()
  await t.expect(joinModal.title.exists).ok('User can\'t see "Join community" title')
  await joinModal.switchToCreateCommunity()

  // User is on "Create community" page, enters valid community name and presses the button
  const createModal = new CreateCommunityModal()  
  await t.expect(createModal.title.exists).ok()
  await createModal.typeCommunityName('testcommunity')
  await createModal.submit()

  // User sees "register username" page, enters the valid name and submits by clicking on the button
  const registerModal = new RegisterUsernameModal()
  await t.expect(registerModal.title.exists).ok()
  await registerModal.typeUsername('testuser')
  await registerModal.submit()

  // User waits for the spinner to disappear and then sees general channel
  const generalChannel = new Channel('general')
  await t.expect(new LoadingPanel('Creating community').title.exists).notOk(`"Creating community" spinner is still visible after ${longTimeout}ms`, { timeout: longTimeout })
  await t.expect(generalChannel.title.exists).ok('User can\'t see "general" channel')

  // User sends a message
  await t.expect(generalChannel.messageInput.exists).ok()
  await generalChannel.sendMessage('Hello everyone')

  // Sent message is visible on the messages' list as part of a group
  await t.expect(generalChannel.messagesList.exists).ok('Could not find placeholder for messages', { timeout: 30000 })

  await t.expect(generalChannel.messagesGroup.exists).ok({ timeout: 30000 })
  await t.expect(generalChannel.messagesGroup.count).eql(1)
  await t.expect(generalChannel.messagesGroupContent.exists).ok()
  await t.expect(generalChannel.messagesGroupContent.textContent).eql('Hello\xa0everyone')
  await t.wait(10000) // TODO: remove after fixing https://github.com/ZbayApp/monorepo/issues/222
})

test('User reopens app, sees general channel and the messages he sent before', async t => {
  await goToMainPage()
  
  // User opens app for the first time, sees spinner, waits for spinner to disappear
  await t.expect(new LoadingPanel('Starting Quiet').title.exists).notOk(`"Starting Quiet" spinner is still visible after ${longTimeout}ms`, { timeout: longTimeout })

  // Returning user sees "general" channel
  const generalChannel = new Channel('general')
  await t.expect(generalChannel.title.exists).ok('User can\'t see "general" channel')

  // User sees the message sent previously
  await t.expect(generalChannel.messagesList.exists).ok('Could not find placeholder for messages', { timeout: 30000 })

  await t.expect(generalChannel.messagesGroup.exists).ok({ timeout: 30000 })
  await t.expect(generalChannel.messagesGroup.count).eql(1)

  await t.expect(generalChannel.messagesGroupContent.exists).ok()
  await t.expect(generalChannel.messagesGroupContent.textContent).eql('Hello\xa0everyone')
})
