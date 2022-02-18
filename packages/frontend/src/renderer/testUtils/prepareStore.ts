import {
  communities,
  identity,
  users,
  errors,
  messages,
  publicChannels,
  connection,
  StoreKeys as NectarStoreKeys,
  settings
} from '@quiet/nectar'
import { StoreKeys } from '../store/store.keys'
import { combineReducers, createStore, applyMiddleware } from 'redux'
import createSagaMiddleware, { SagaMonitor as SagaMonitorType } from 'redux-saga'
import thunk from 'redux-thunk'
import rootSaga from '../sagas/index.saga'
import { reducer as appReducer } from '../store/handlers/app'
import { socketActions, socketReducer } from '../sagas/socket/socket.slice'
import { modalsReducer } from '../sagas/modals/modals.slice'
import MockedSocket from 'socket.io-mock'
import { fork, delay, call, put } from 'typed-redux-saga'
import { map } from 'lodash'

export const reducers = {
  [NectarStoreKeys.Communities]: communities.reducer,
  [NectarStoreKeys.Identity]: identity.reducer,
  [NectarStoreKeys.Users]: users.reducer,
  [NectarStoreKeys.Errors]: errors.reducer,
  [NectarStoreKeys.Messages]: messages.reducer,
  [NectarStoreKeys.PublicChannels]: publicChannels.reducer,
  [NectarStoreKeys.Connection]: connection.reducer,
  [NectarStoreKeys.Settings]: settings.reducer,
  [StoreKeys.App]: appReducer,
  [StoreKeys.Socket]: socketReducer,
  [StoreKeys.Modals]: modalsReducer
}

interface option {
  effectId: number
  parentEffectId: number
  label?: string
  effect: any
}

class SagaMonitor {
  effectsTriggeredArray: Array<{ [effectId: number]: option }>
  effectsResolvedArray: Array<{ [effectId: number]: any }>
  constructor(
  ) {
    this.effectsTriggeredArray = []
    this.effectsResolvedArray = []
  }

  effectTriggered: SagaMonitorType['effectTriggered'] = (options) => {
    this.effectsTriggeredArray.push({ [options.effectId]: options })
  }

  effectResolved: SagaMonitorType['effectResolved'] = (effectId, result) => {
    this.effectsResolvedArray.push({ [effectId]: result })
  }

  public isEffectResolved = (effectName) => {
    const it = this.effectsResolvedArray.filter((effect) => {
      const effectNameObject = Object.values(Object.values(effect)[0])[2] as any
      return effectNameObject?.name === effectName
    })

    return Boolean(it.length)
  }
}

export const prepareStore = async (
  mockedState?: { [key in StoreKeys | NectarStoreKeys]?: any },
  mockedSocket?: MockedSocket
) => {
  const combinedReducers = combineReducers(reducers)

  const sagaMonitor = new SagaMonitor()
  const sagaMiddleware = createSagaMiddleware({
    sagaMonitor
  })

  const store = createStore(
    combinedReducers,
    mockedState,
    applyMiddleware(...[sagaMiddleware, thunk])
  )
  // Fork Nectar's sagas (require mocked socket.io-client)
  if (mockedSocket) {
    sagaMiddleware.run(rootSaga)
    // Mock socket connected event
    await sagaMiddleware.run(mockSocketConnectionSaga, mockedSocket).toPromise()
  }

  return {
    store,
    runSaga: sagaMiddleware.run,
    sagaMonitor
  }
}

function* mockSocketConnectionSaga(socket: MockedSocket): Generator {
  yield* fork(function* (): Generator {
    yield* delay(1000)
    yield* call(() => {
      socket.socketClient.emit('connect')
    })
  })
  yield* put(socketActions.startConnection({ dataPort: 4677 }))
}
