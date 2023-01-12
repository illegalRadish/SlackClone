import { applyEmitParams, Socket } from '../../../types'
import { PayloadAction } from '@reduxjs/toolkit'
import { select, put, apply } from 'typed-redux-saga'
import { SocketActionTypes } from '../../socket/const/actionTypes'
import { identitySelectors } from '../../identity/identity.selectors'
import { filesActions } from '../files.slice'
import { DownloadState } from '../files.types'

export function* cancelDownloadSaga(
  socket: Socket,
  action: PayloadAction<ReturnType<typeof filesActions.cancelDownload>['payload']>
): Generator {
  const identity = yield* select(identitySelectors.currentIdentity)

  const { mid, cid } = action.payload

  yield* put(
    filesActions.updateDownloadStatus({
      mid: mid,
      cid: cid,
      downloadState: DownloadState.Canceling
    })
  )

  yield* apply(
    socket,
    socket.emit,
    applyEmitParams(SocketActionTypes.CANCEL_DOWNLOAD, {
      peerId: identity.peerId.id,
      mid: mid
    })
  )
}